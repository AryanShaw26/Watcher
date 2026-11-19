import os from 'node:os';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { redis, redisKey } from '../redis/client.js';
import type { CheckResultEvent } from './event.js';
import type { QueueMessage, ResultQueue } from './types.js';

type StreamEntry=[string,string[]];
type StreamBatch=[string,StreamEntry[]][];
const sleep=(ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));

export class RedisStreamsQueue implements ResultQueue {
  private readonly stream=redisKey('stream:check.results');
  private readonly dlq=redisKey('stream:check.results.dlq');
  private readonly consumerName=`${os.hostname()}-${process.pid}`;
  private blocking:Redis=redis.duplicate({enableOfflineQueue:false,maxRetriesPerRequest:2,connectTimeout:5000});
  private closed=false;
  private consumeTask?:Promise<void>;

  constructor() {
    this.blocking.on('error',(error:Error)=>logger.warn({error:error.message},'Redis Streams connection error'));
  }

  async publish(event:CheckResultEvent):Promise<void> {
    await redis.xadd(this.stream,'MAXLEN','~',String(env.REDIS_STREAM_MAXLEN),'*','key',event.monitorId,'value',JSON.stringify(event));
  }

  private async ensureGroup():Promise<void> {
    try { await redis.xgroup('CREATE',this.stream,env.KAFKA_CONSUMER_GROUP,'0','MKSTREAM'); }
    catch(error) {
      if(!(error instanceof Error)||!error.message.includes('BUSYGROUP'))throw error;
    }
  }

  async consume(handler:(msg:QueueMessage)=>Promise<void>):Promise<void> {
    this.closed=false;
    this.consumeTask=this.loop(handler);
    return this.consumeTask;
  }

  private async processEntries(entries:StreamEntry[],handler:(msg:QueueMessage)=>Promise<void>):Promise<void> {
    for(const [id,fields] of entries) {
      const record:Record<string,string>={};
      for(let index=0;index<fields.length;index+=2)record[fields[index]]=fields[index+1];
      try {
        await handler({
          key:record.key??'unknown',value:record.value??'',
          meta:{topic:env.KAFKA_TOPIC_RESULTS,id}
        });
        await this.blocking.xack(this.stream,env.KAFKA_CONSUMER_GROUP,id);
      } catch(error) {
        logger.error({error,id},'Redis Streams handler failed; message left pending');
      }
    }
  }

  private async recoverPending(handler:(msg:QueueMessage)=>Promise<void>):Promise<void> {
    const raw=await this.blocking.call(
      'XAUTOCLAIM',this.stream,env.KAFKA_CONSUMER_GROUP,this.consumerName,'60000','0-0','COUNT','10'
    ) as [string,StreamEntry[],string[]];
    if(raw?.[1]?.length)await this.processEntries(raw[1],handler);
  }

  private async loop(handler:(msg:QueueMessage)=>Promise<void>):Promise<void> {
    let lastRecovery=0;
    while(!this.closed) {
      try {
        await this.ensureGroup();
        if(this.blocking.status==='wait')await this.blocking.connect();
        if(this.blocking.status!=='ready') {
          await new Promise<void>((resolve,reject)=>{
            const ready=()=>{this.blocking.off('error',failed);resolve();};
            const failed=(error:Error)=>{this.blocking.off('ready',ready);reject(error);};
            this.blocking.once('ready',ready);
            this.blocking.once('error',failed);
          });
        }
        if(Date.now()-lastRecovery>=30000) {
          await this.recoverPending(handler);
          lastRecovery=Date.now();
        }
        const response=await this.blocking.xreadgroup(
          'GROUP',env.KAFKA_CONSUMER_GROUP,this.consumerName,
          'COUNT','10','BLOCK','5000','STREAMS',this.stream,'>'
        ) as StreamBatch|null;
        if(response)for(const [,entries] of response)await this.processEntries(entries,handler);
      } catch(error) {
        if(!this.closed) {
          logger.error({error},'Redis Streams consumer error');
          await sleep(1000);
        }
      }
    }
  }

  async publishToDlq(msg:QueueMessage,reason:{error:string;attempts:number}):Promise<void> {
    await redis.xadd(
      this.dlq,'MAXLEN','~',String(env.REDIS_STREAM_MAXLEN),'*',
      'value',msg.value,'key',msg.key,'error',reason.error.slice(0,500),
      'attempts',String(reason.attempts),'sourceId',msg.meta.id??'','failedAt',new Date().toISOString()
    );
  }

  async getStats():Promise<{connected:boolean;lag:number|null;dlqDepth:number|null}> {
    try {
      const [groups,dlqDepth]=await Promise.all([
        redis.xinfo('GROUPS',this.stream),
        redis.xlen(this.dlq)
      ]);
      const group=(groups as unknown[][]).find((row)=> {
        const values=row as unknown[];
        for(let index=0;index<values.length;index+=2) {
          if(values[index]==='name'&&values[index+1]===env.KAFKA_CONSUMER_GROUP)return true;
        }
        return false;
      }) as unknown[]|undefined;
      let lag:number|null=null;
      let entriesRead:number|null=null;
      if(group) {
        for(let index=0;index<group.length;index+=2) {
          if(group[index]==='lag'&&group[index+1]!==null)lag=Number(group[index+1]);
          if(group[index]==='entries-read'&&group[index+1]!==null)entriesRead=Number(group[index+1]);
        }
      }
      if(lag===null) {
        const length=await redis.xlen(this.stream);
        lag=Math.max(0,length-(entriesRead??0));
      }
      return {connected:true,lag,dlqDepth};
    } catch { return {connected:false,lag:null,dlqDepth:null}; }
  }

  async close():Promise<void> {
    this.closed=true;
    this.blocking.disconnect();
    await this.consumeTask?.catch(()=>undefined);
  }
}
