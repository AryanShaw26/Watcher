import { createQueue } from '../queue/index.js';
import { checkResultEventSchema } from '../queue/event.js';

const [eventId,monitorId]=process.argv.slice(2);
if(!monitorId) {
  console.error('Usage: npm run event:replay -- <eventId> <monitorId>');
  process.exit(1);
}
if(!eventId) {
  console.error('eventId is required');
  process.exit(1);
}

const event=checkResultEventSchema.parse({
  schemaVersion:1,eventId,monitorId,checkedAt:new Date().toISOString(),
  status:'up',statusCode:200,responseTimeMs:1,error:null,source:'manual'
});
const queue=createQueue();
try {
  await queue.publish(event);
  console.info(`Published event ${eventId} for monitor ${monitorId}`);
} finally {
  await queue.close();
}
