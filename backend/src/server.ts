import { logger } from './lib/logger.js';
import { startRoles, stopRoles } from './roles.js';

let shuttingDown=false;
async function shutdown(signal:string):Promise<void> {
  if(shuttingDown)return;
  shuttingDown=true;
  try { await stopRoles(signal); process.exit(0); }
  catch(error) { logger.fatal({error},'Graceful shutdown failed'); process.exit(1); }
}

void startRoles().catch((error)=>{
  logger.fatal({error},'Watcher failed to start');
  process.exit(1);
});

process.on('SIGTERM',()=>void shutdown('SIGTERM'));
process.on('SIGINT',()=>void shutdown('SIGINT'));
process.on('unhandledRejection',(error)=>{logger.fatal({error},'Unhandled rejection');process.exit(1);});
process.on('uncaughtException',(error)=>{logger.fatal({error},'Uncaught exception');process.exit(1);});
