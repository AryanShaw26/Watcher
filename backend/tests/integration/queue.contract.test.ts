import {afterEach,describe,expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
import {env} from '../../src/config/env.js';
import {createQueue} from '../../src/queue/index.js';
import type {CheckResultEvent} from '../../src/queue/event.js';

const makeEvent=():CheckResultEvent=>({
  schemaVersion:1,eventId:crypto.randomUUID(),monitorId:crypto.randomUUID(),
  checkedAt:new Date().toISOString(),status:'up',statusCode:200,responseTimeMs:1,error:null,source:'scheduler'
});
let queue:ReturnType<typeof createQueue>|undefined;

afterEach(async()=>{await queue?.close();queue=undefined;});

describe.each(['kafka','redis-streams'] as const)('%s queue contract',driver=>{
  it('delivers an event and exposes a dead-letter entry',async()=>{
    env.QUEUE_DRIVER=driver;
    queue=createQueue();
    const event=makeEvent();
    const received=vi.fn();
    void queue.consume(async(message)=>{
      if(JSON.parse(message.value).eventId===event.eventId)received();
    });
    await queue.publish(event);
    await vi.waitFor(()=>expect(received).toHaveBeenCalledOnce(),{timeout:20000});
    await queue.publishToDlq(
      {key:event.monitorId,value:JSON.stringify(event),meta:{topic:env.KAFKA_TOPIC_RESULTS}},
      {error:'test poison',attempts:0}
    );
    expect((await queue.getStats()).dlqDepth).toBeGreaterThan(0);
  },60000);

  it('redelivers a message after the handler rejects it',async()=>{
    env.QUEUE_DRIVER=driver;
    queue=createQueue();
    const event=makeEvent();
    let attempts=0;
    const acknowledged=vi.fn();
    void queue.consume(async(message)=>{
      if(JSON.parse(message.value).eventId!==event.eventId)return;
      attempts++;
      if(attempts===1)throw new Error('transient handler failure');
      acknowledged();
    });
    await queue.publish(event);
    await vi.waitFor(()=>expect(acknowledged).toHaveBeenCalledOnce(),{timeout:90000,interval:1000});
    expect(attempts).toBe(2);
  },100000);

  it('stops delivering after close',async()=>{
    env.QUEUE_DRIVER=driver;
    queue=createQueue();
    const first=makeEvent();
    const afterClose=makeEvent();
    const received:string[]=[];
    void queue.consume(async(message)=>{
      const eventId=JSON.parse(message.value).eventId;
      if(eventId===first.eventId||eventId===afterClose.eventId)received.push(eventId);
    });
    await queue.publish(first);
    await vi.waitFor(()=>expect(received).toContain(first.eventId),{timeout:20000});
    await queue.close();
    await queue.publish(afterClose);
    await new Promise((resolve)=>setTimeout(resolve,2000));
    expect(received).toEqual([first.eventId]);
  },30000);
});
