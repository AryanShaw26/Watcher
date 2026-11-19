import {describe,expect,it,vi} from 'vitest';
import {publishOrFallback} from './publish.js';
import {logger} from '../lib/logger.js';
import type {ResultQueue} from '../queue/types.js';
import type {CheckResultEvent} from '../queue/event.js';

const event:CheckResultEvent={
  schemaVersion:1,eventId:'6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a11',
  monitorId:'6f1c2c1e-6f1d-4e0a-9d0b-2f2c5a0e9a12',
  checkedAt:new Date().toISOString(),status:'up',statusCode:200,responseTimeMs:1,error:null,source:'scheduler'
};
const queue=():ResultQueue=>({
  publish:vi.fn().mockRejectedValue(new Error('queue down')),
  consume:vi.fn(),publishToDlq:vi.fn(),getStats:vi.fn(),close:vi.fn()
});

describe('publishOrFallback',()=>{
  it('stores the event through DB fallback when enabled',async()=>{
    const persist=vi.fn().mockResolvedValue({inserted:true,applied:true,previousStatus:'down'});
    const cache=vi.fn().mockResolvedValue(undefined);
    expect(await publishOrFallback(queue(),event,{persist,cache,fallbackEnabled:true})).toBe('fallback');
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(event);
    expect(cache).toHaveBeenCalledWith(event.monitorId);
  });

  it('reports the lost path when fallback is disabled',async()=>{
    const persist=vi.fn();
    const error=vi.spyOn(logger,'error');
    expect(await publishOrFallback(queue(),event,{persist,fallbackEnabled:false})).toBe('lost');
    expect(persist).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({path:'lost'}),
      'Result event could not be published'
    );
    error.mockRestore();
  });

  it('keeps the successful fallback when the status cache refresh fails',async()=>{
    const persist=vi.fn().mockResolvedValue({inserted:true,applied:true,previousStatus:'pending'});
    const cache=vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    await expect(publishOrFallback(queue(),event,{persist,cache,fallbackEnabled:true})).resolves.toBe('fallback');
    expect(persist).toHaveBeenCalledOnce();
    expect(cache).toHaveBeenCalledOnce();
  });

  it('uses the publish timeout before taking the configured fallback',async()=>{
    const slowQueue=queue();
    vi.spyOn(slowQueue,'publish').mockImplementation(()=>new Promise<void>(()=>undefined));
    const persist=vi.fn().mockResolvedValue({inserted:true,applied:false,previousStatus:null});
    expect(await publishOrFallback(slowQueue,event,{
      persist,fallbackEnabled:true,publishTimeoutMs:5
    })).toBe('fallback');
    expect(persist).toHaveBeenCalledOnce();
  });
});
