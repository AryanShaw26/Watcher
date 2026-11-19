import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { redis, redisKey } from './client.js';

export type CachedStatus = {
  status:string;
  statusCode:number|null;
  responseTimeMs:number|null;
  lastCheckedAt:string|null;
  lastError:string|null;
  consecutiveFailures:number|null;
};

export async function setStatusFromRow(row:Record<string,unknown>):Promise<void> {
  await setStatus(String(row.id),{
    status:String(row.current_status),
    statusCode:row.last_status_code===null?null:Number(row.last_status_code),
    responseTimeMs:row.last_response_time_ms===null?null:Number(row.last_response_time_ms),
    lastCheckedAt:row.last_checked_at?new Date(String(row.last_checked_at)).toISOString():null,
    lastError:row.last_error===null?null:String(row.last_error),
    consecutiveFailures:row.consecutive_failures===null?null:Number(row.consecutive_failures)
  });
}

function nullable(value:string|undefined):string|null {
  return value === undefined || value === '' ? null : value;
}

function nullableNumber(value:string|undefined):number|null {
  const parsed = nullable(value);
  return parsed === null ? null : Number(parsed);
}

export async function setStatus(monitorId:string,status:CachedStatus):Promise<void> {
  try {
    const key=redisKey(`status:${monitorId}`);
    await redis.hset(key,{
      status:status.status,
      statusCode:status.statusCode ?? '',
      responseTimeMs:status.responseTimeMs ?? '',
      lastCheckedAt:status.lastCheckedAt ?? '',
      lastError:status.lastError ?? '',
      consecutiveFailures:status.consecutiveFailures ?? ''
    });
    await redis.expire(key,env.STATUS_CACHE_TTL_SECONDS);
  } catch(error) { logger.warn({error,monitorId},'Status cache write failed'); }
}

export async function getStatuses(monitorIds:string[]):Promise<Map<string,CachedStatus>> {
  const statuses=new Map<string,CachedStatus>();
  if(!monitorIds.length)return statuses;
  try {
    const pipeline=redis.pipeline();
    for(const id of monitorIds)pipeline.hgetall(redisKey(`status:${id}`));
    const result=await pipeline.exec();
    result?.forEach((entry,index)=>{
      const data=entry?.[1] as Record<string,string>|null;
      if(!data||!data.status)return;
      statuses.set(monitorIds[index],{
        status:data.status,
        statusCode:nullableNumber(data.statusCode),
        responseTimeMs:nullableNumber(data.responseTimeMs),
        lastCheckedAt:nullable(data.lastCheckedAt),
        lastError:nullable(data.lastError),
        consecutiveFailures:nullableNumber(data.consecutiveFailures)
      });
    });
  } catch(error) { logger.warn({error},'Status cache read failed'); }
  return statuses;
}

export async function deleteStatus(monitorId:string):Promise<void> {
  try { await redis.del(redisKey(`status:${monitorId}`)); }
  catch(error) { logger.warn({error,monitorId},'Status cache delete failed'); }
}

export async function setLastProcessed(value:string):Promise<void> {
  try { await redis.set(redisKey('pipeline:last_processed'),value); }
  catch(error) { logger.warn({error},'Pipeline timestamp write failed'); }
}

export async function getLastProcessed():Promise<string|null> {
  try { return await redis.get(redisKey('pipeline:last_processed')); }
  catch(error) { logger.warn({error},'Pipeline timestamp read failed'); return null; }
}
