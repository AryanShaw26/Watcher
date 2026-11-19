import { beforeEach,describe,expect,it,vi } from 'vitest';
import { MemoryQueue } from '../queue/memory.queue.js';
import { createMessageHandler } from './handleMessage.js';
import type { QueueMessage } from '../queue/types.js';
import { env } from '../config/env.js';

const event={
  schemaVersion:1,eventId:'6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a11',
  monitorId:'6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a12',
  checkedAt:'2026-01-01T10:00:00.000Z',status:'up',statusCode:200,
  responseTimeMs:142,error:null,source:'scheduler'
};
const message=(value:string):QueueMessage=>({key:event.monitorId,value,meta:{topic:'check.results',partition:0,offset:'1'}});

describe('consumer message handler',()=>{
  beforeEach(()=>{env.CONSUMER_MAX_ATTEMPTS=3;});

  it('sends invalid JSON to DLQ without retrying',async()=>{
    const queue=new MemoryQueue();
    const invalid=message('not json');
    const publishToDlq=vi.spyOn(queue,'publishToDlq');
    const record=vi.fn();
    await createMessageHandler(queue,{record,delay:async()=>undefined})(invalid);
    expect(record).not.toHaveBeenCalled();
    expect(publishToDlq).toHaveBeenCalledWith(invalid,expect.objectContaining({
      attempts:0,error:expect.stringContaining('not valid JSON')
    }));
    expect((await queue.getStats()).dlqDepth).toBe(1);
  });

  it('retries transient storage failures and acknowledges after success',async()=>{
    const queue=new MemoryQueue();
    const record=vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({inserted:true,applied:false,previousStatus:'up'});
    const markProcessed=vi.fn();
    await createMessageHandler(queue,{record,delay:async()=>undefined,markProcessed})(message(JSON.stringify(event)));
    expect(record).toHaveBeenCalledTimes(3);
    expect(markProcessed).toHaveBeenCalledOnce();
    expect((await queue.getStats()).dlqDepth).toBe(0);
  });

  it('sends the final failure to DLQ after the configured attempts',async()=>{
    const queue=new MemoryQueue();
    const publishToDlq=vi.spyOn(queue,'publishToDlq');
    const record=vi.fn().mockRejectedValue(new Error('database unavailable'));
    await createMessageHandler(queue,{record,delay:async()=>undefined})(message(JSON.stringify(event)));
    expect(record).toHaveBeenCalledTimes(env.CONSUMER_MAX_ATTEMPTS);
    expect(publishToDlq).toHaveBeenCalledWith(
      expect.objectContaining({value:JSON.stringify(event)}),
      expect.objectContaining({attempts:env.CONSUMER_MAX_ATTEMPTS,error:'database unavailable'})
    );
    expect((await queue.getStats()).dlqDepth).toBe(1);
  });

  it('uses the exponential retry delays between attempts',async()=>{
    const queue=new MemoryQueue();
    const record=vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({inserted:true,applied:true,previousStatus:'pending'});
    const delay=vi.fn(async(_milliseconds:number)=>undefined);
    await createMessageHandler(queue,{record,delay,cacheStatus:vi.fn(),markProcessed:vi.fn()})(message(JSON.stringify(event)));
    expect(delay.mock.calls.map(([milliseconds])=>milliseconds)).toEqual([
      env.CONSUMER_RETRY_BASE_MS,
      env.CONSUMER_RETRY_BASE_MS*4
    ]);
  });

  it('acknowledges a deleted monitor without retrying or sending to the DLQ',async()=>{
    const queue=new MemoryQueue();
    const foreignKeyError=Object.assign(new Error('deleted monitor'),{code:'23503'});
    const record=vi.fn().mockRejectedValue(foreignKeyError);
    await expect(createMessageHandler(queue,{
      record,delay:async()=>undefined,markProcessed:vi.fn()
    })(message(JSON.stringify(event)))).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledOnce();
    expect((await queue.getStats()).dlqDepth).toBe(0);
  });

  it('throws only when publishing the DLQ fails',async()=>{
    const queue=new MemoryQueue();
    vi.spyOn(queue,'publishToDlq').mockRejectedValue(new Error('broker unavailable'));
    await expect(createMessageHandler(queue,{record:vi.fn().mockRejectedValue(new Error('db')),delay:async()=>undefined})(message('bad')))
      .rejects.toThrow('broker unavailable');
  });

  it('throws on a final processing failure only when the DLQ publish fails',async()=>{
    const queue=new MemoryQueue();
    vi.spyOn(queue,'publishToDlq').mockRejectedValue(new Error('broker unavailable'));
    const record=vi.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(createMessageHandler(queue,{
      record,delay:async()=>undefined
    })(message(JSON.stringify(event)))).rejects.toThrow('broker unavailable');
    expect(record).toHaveBeenCalledTimes(env.CONSUMER_MAX_ATTEMPTS);
  });

  it('acknowledges a duplicate after updating the pipeline timestamp without a cache write',async()=>{
    const queue=new MemoryQueue();
    const cacheStatus=vi.fn();
    const markProcessed=vi.fn();
    const record=vi.fn().mockResolvedValue({inserted:false,applied:false,previousStatus:null});
    await expect(createMessageHandler(queue,{record,cacheStatus,markProcessed})(message(JSON.stringify(event)))).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledOnce();
    expect(cacheStatus).not.toHaveBeenCalled();
    expect(markProcessed).toHaveBeenCalledOnce();
  });
});
