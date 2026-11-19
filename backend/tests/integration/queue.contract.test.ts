import {afterEach,describe,expect,it,vi} from 'vitest';
import {env} from '../../src/config/env.js';
import {createQueue} from '../../src/queue/index.js';
import type {CheckResultEvent} from '../../src/queue/event.js';

const event:CheckResultEvent={
  schemaVersion:1,eventId:'6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a11',
  monitorId:'6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a12',
  checkedAt:new Date().toISOString(),status:'up',statusCode:200,responseTimeMs:1,error:null,source:'scheduler'
};
let queue:ReturnType<typeof createQueue>|undefined;

afterEach(async()=>{await queue?.close();queue=undefined;});

describe.each(['kafka','redis-streams'] as const)('%s queue contract',driver=>{
  it('delivers an event and exposes a dead-letter entry',async()=>{
    env.QUEUE_DRIVER=driver;
    queue=createQueue();
    const received:unknown[]=[];
    void queue.consume(async(message)=>{received.push(JSON.parse(message.value));});
    await queue.publish(event);
    await vi.waitFor(()=>expect(received).toHaveLength(1),{timeout:20000});
    await queue.publishToDlq(
      {key:event.monitorId,value:JSON.stringify(event),meta:{topic:env.KAFKA_TOPIC_RESULTS}},
      {error:'test poison',attempts:0}
    );
    expect((await queue.getStats()).dlqDepth).toBeGreaterThan(0);
  },60000);
});
