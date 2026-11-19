import type { CheckResultEvent } from './event.js';

export type QueueMessage={
  key:string;
  value:string;
  meta:{topic:string;partition?:number;offset?:string;id?:string};
};

export interface ResultQueue {
  publish(event:CheckResultEvent):Promise<void>;
  consume(handler:(msg:QueueMessage)=>Promise<void>):Promise<void>;
  publishToDlq(msg:QueueMessage,reason:{error:string;attempts:number}):Promise<void>;
  getStats():Promise<{connected:boolean;lag:number|null;dlqDepth:number|null}>;
  close():Promise<void>;
}
