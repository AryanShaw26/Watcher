import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { waitForShutdownTask } from './lib/gracefulShutdown.js';
import { closeRedis } from './redis/client.js';
import { createQueue } from './queue/index.js';
import type { ResultQueue } from './queue/types.js';
import { startConsumer } from './consumer/consumer.js';
import { startScheduler, stopScheduler } from './scheduler/scheduler.js';
import { startRetention, stopRetention } from './scheduler/retention.js';
import type { Server } from 'node:http';

export type Role='api'|'scheduler'|'consumer';
export function parseRoles(value:string):Set<Role> {
  const allowed=new Set<Role>(['api','scheduler','consumer']);
  const roles=value.split(',').map((role)=>role.trim()).filter(Boolean);
  if(!roles.length)throw new Error('ROLES must contain at least one of api, scheduler, consumer');
  const invalid=roles.filter((role)=>!allowed.has(role as Role));
  if(invalid.length)throw new Error(`Unknown role(s): ${invalid.join(', ')}. Allowed roles: api, scheduler, consumer`);
  return new Set(roles as Role[]);
}

let server:Server|undefined;
let queue:ResultQueue|undefined;
let consumerTask:Promise<void>|undefined;

export async function startRoles():Promise<void> {
  const roles=parseRoles(env.ROLES);
  queue=createQueue();
  if(roles.has('consumer')) {
    consumerTask=startConsumer(queue).catch((error)=>logger.error({error},'Consumer stopped'));
  }
  if(roles.has('scheduler')) {
    startScheduler(queue);
    startRetention();
  }
  if(roles.has('api')) {
    const app=buildApp(queue);
    server=app.listen(env.PORT,()=>logger.info({port:env.PORT,roles:[...roles]},'Watcher API listening'));
  }
}

export async function stopRoles(signal='shutdown'):Promise<void> {
  logger.info({signal},'Stopping active roles');
  const deadline=Date.now()+10000;
  const failures:unknown[]=[];
  const wait=async(label:string,task:Promise<unknown>):Promise<boolean>=>{
    const result=await waitForShutdownTask(task,Math.max(0,deadline-Date.now()));
    if(result.status==='failed') {
      failures.push(result.error);
      logger.error({error:result.error},`${label} failed during shutdown`);
    } else if(result.status==='timed-out') {
      logger.warn(`${label} did not stop within the shutdown deadline`);
    }
    return result.status==='completed';
  };
  if(server) {
    const activeServer=server;
    const closed=await wait('API server',new Promise<void>((resolve,reject)=>{
      activeServer.close((error)=>error?reject(error):resolve());
    }));
    if(!closed)activeServer.closeAllConnections();
    server=undefined;
  }
  stopRetention();
  await wait('Scheduler',stopScheduler());
  if(queue)await wait('Queue',queue.close());
  if(consumerTask)await wait('Consumer',consumerTask);
  await wait('Redis',closeRedis());
  await wait('Postgres pool',pool.end());
  if(failures.length)throw new AggregateError(failures,'One or more resources failed to close cleanly.');
}
