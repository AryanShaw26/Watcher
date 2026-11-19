import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { pool } from '../db/pool.js';
import { checkResultEventSchema } from '../queue/event.js';
import type { QueueMessage, ResultQueue } from '../queue/types.js';
import { recordResult } from '../modules/results/result.service.js';
import { setLastProcessed, setStatusFromRow } from '../redis/statusCache.js';

type RetryOptions={
  delay?:(milliseconds:number)=>Promise<void>;
  record?:(event:ReturnType<typeof checkResultEventSchema.parse>)=>Promise<{inserted:boolean;applied:boolean;previousStatus:'pending'|'up'|'down'|null}>;
  cacheStatus?:(monitorId:string)=>Promise<void>;
  markProcessed?:()=>Promise<void>;
};
const defaultDelay=(milliseconds:number)=>new Promise<void>((resolve)=>setTimeout(resolve,milliseconds));

export function createMessageHandler(queue:ResultQueue,options:RetryOptions={}) {
  const delay=options.delay??defaultDelay;
  const store=options.record??recordResult;
  const cacheStatus=options.cacheStatus??(async(monitorId:string)=>{
    try {
      const monitor=await pool.query('SELECT * FROM monitors WHERE id=$1',[monitorId]);
      if(monitor.rows[0])await setStatusFromRow(monitor.rows[0]);
    } catch(error) {
      logger.warn({error,monitorId},'Could not refresh the status cache');
    }
  });
  const markProcessed=options.markProcessed??(()=>setLastProcessed(new Date().toISOString()));
  return async function handleMessage(msg:QueueMessage):Promise<void> {
    let event:ReturnType<typeof checkResultEventSchema.parse>;
    try {
      event=checkResultEventSchema.parse(JSON.parse(msg.value));
    } catch(error) {
      await queue.publishToDlq(msg,{error:error instanceof Error?error.message:'Invalid event',attempts:0});
      logger.warn({topic:msg.meta.topic,offset:msg.meta.offset},'Poison message sent to DLQ');
      return;
    }

    for(let attempt=1;attempt<=env.CONSUMER_MAX_ATTEMPTS;attempt++) {
      try {
        const result=await store(event);
        if(!result.inserted) {
          logger.debug({eventId:event.eventId},'Duplicate event ignored');
        }
        if(result.inserted&&result.applied) {
          await cacheStatus(event.monitorId);
        } else if(result.inserted) {
          logger.debug({eventId:event.eventId},'Out-of-order event stored without changing current status');
        }
        await markProcessed();
        logger.info({
          eventId:event.eventId,monitorId:event.monitorId,status:event.status,
          partition:msg.meta.partition,offset:msg.meta.offset,inserted:result.inserted,applied:result.applied
        },'consumed');
        return;
      } catch(error) {
        if(error&&typeof error==='object'&&'code'in error&&error.code==='23503') {
          logger.debug({eventId:event.eventId,monitorId:event.monitorId},'Result discarded because monitor was deleted');
          await markProcessed();
          return;
        }
        if(attempt<env.CONSUMER_MAX_ATTEMPTS) {
          await delay(env.CONSUMER_RETRY_BASE_MS*Math.pow(4,attempt-1));
          continue;
        }
        await queue.publishToDlq(msg,{error:error instanceof Error?error.message:'Result storage failed',attempts:attempt});
        logger.error({eventId:event.eventId,attempts:attempt,error},'Result sent to DLQ after retries');
        return;
      }
    }
  };
}

export async function handleMessage(queue:ResultQueue,msg:QueueMessage):Promise<void> {
  return createMessageHandler(queue)(msg);
}
