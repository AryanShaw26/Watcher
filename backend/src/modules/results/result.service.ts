import { withTransaction } from '../../db/pool.js';
import type { CheckResultEvent } from '../../queue/event.js';

export type RecordResultOutcome={
  inserted:boolean;
  applied:boolean;
  previousStatus:'pending'|'up'|'down'|null;
};

export function mapResult(row:Record<string,unknown>) {
  return {
    id:row.id,checkedAt:row.checked_at,status:row.status,statusCode:row.status_code,
    responseTimeMs:row.response_time_ms,error:row.error
  };
}

export async function recordResult(event:CheckResultEvent):Promise<RecordResultOutcome> {
  return withTransaction(async(client)=>{
    const inserted=await client.query(
      `INSERT INTO check_results
       (event_id,monitor_id,checked_at,status,status_code,response_time_ms,error)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (event_id) DO NOTHING RETURNING id`,
      [event.eventId,event.monitorId,event.checkedAt,event.status,event.statusCode,event.responseTimeMs,event.error]
    );
    if(!inserted.rowCount)return {inserted:false,applied:false,previousStatus:null};

    const previous=await client.query(
      'SELECT current_status FROM monitors WHERE id=$1 FOR UPDATE',
      [event.monitorId]
    );
    const previousStatus=previous.rows[0]?.current_status as 'pending'|'up'|'down'|undefined;
    if(!previousStatus)return {inserted:true,applied:false,previousStatus:null};

    const updated=await client.query(
      `UPDATE monitors SET current_status=$1,last_checked_at=$2,last_response_time_ms=$3,
       last_status_code=$4,last_error=$5,
       consecutive_failures=CASE WHEN $1='up' THEN 0 ELSE consecutive_failures+1 END,
       updated_at=now()
       WHERE id=$6 AND (last_checked_at IS NULL OR last_checked_at <= $2)`,
      [event.status,event.checkedAt,event.responseTimeMs,event.statusCode,event.error,event.monitorId]
    );
    return {inserted:true,applied:(updated.rowCount??0)>0,previousStatus};
  });
}
