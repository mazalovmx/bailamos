import type {JobDef} from '../../worker/types';
import {sendWeeklyDigests} from '../digest/send';
export const digestJobs: JobDef[] = [
  // Monday 07:00 UTC. Safe to repeat and to run on several workers: each account is claimed once per ISO week.
  {name: 'digest.weekly', cron: '0 7 * * 1', attempts: 3, handler: async () => {
    const result = await sendWeeklyDigests();
    // Failed deliveries gave their claim back; throwing makes the queue retry them with backoff (sent ones are skipped).
    if (result.failed) throw new Error('DIGEST_DELIVERY_FAILED ' + result.failed + '/' + result.candidates);
    return result;
  }}
];
