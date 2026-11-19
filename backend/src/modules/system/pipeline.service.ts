import { env } from '../../config/env.js';
import { getLastProcessed } from '../../redis/statusCache.js';
import { redisIsUp } from '../../redis/client.js';
import type { ResultQueue } from '../../queue/types.js';

export type PipelineResponse={
  state:'healthy'|'lagging'|'degraded';
  reason:'redis'|'queue'|'redis_and_queue'|null;
  queueDriver:'kafka'|'redis-streams'|'memory';
  redis:{status:'up'|'down'};
  queue:{status:'up'|'down';lag:number|null;dlqDepth:number|null};
  lastProcessedAt:string|null;
  checkedAt:string;
};

let cache:{at:number;value:PipelineResponse}|null=null;
export async function getPipelineStatus(queue:ResultQueue):Promise<PipelineResponse> {
  if(cache&&Date.now()-cache.at<5000)return cache.value;
  const [redisUp,queueStats,lastProcessedAt]=await Promise.all([
    redisIsUp(),queue.getStats(),getLastProcessed()
  ]);
  const queueUp=queueStats.connected;
  const reason= !redisUp&&!queueUp?'redis_and_queue':!redisUp?'redis':!queueUp?'queue':null;
  const state=reason?'degraded':queueStats.lag!==null&&queueStats.lag>env.PIPELINE_LAG_WARN?'lagging':'healthy';
  const value:PipelineResponse={
    state,reason,queueDriver:env.QUEUE_DRIVER,
    redis:{status:redisUp?'up':'down'},
    queue:{status:queueUp?'up':'down',lag:queueStats.lag,dlqDepth:queueStats.dlqDepth},
    lastProcessedAt,checkedAt:new Date().toISOString()
  };
  cache={at:Date.now(),value};
  return value;
}

export function clearPipelineCache():void { cache=null; }
