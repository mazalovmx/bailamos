import type {JobDef} from './types';
import {digestJobs} from '../lib/jobs/digest';
import {reminderJobs} from '../lib/jobs/reminders';
import {mediaJobs} from '../lib/jobs/media';
import {maintenanceJobs} from '../lib/jobs/maintenance';
import {importJobs} from '../lib/import/jobs';
import {embedJobs} from '../lib/embeds/refresh';
import {opsJobs} from '../lib/jobs/ops';
import {blogJobs} from '../lib/jobs/blog';
// Every background job of the platform. A feature exports JobDef[] and is added here; the worker entrypoint
// (src/worker/index.ts) registers each definition as a repeatable job and removes schedules that left this list.
export const jobs: JobDef[] = [
  ...digestJobs,       // digest.weekly      — Monday 07:00 UTC
  ...reminderJobs,     // reminders.events   — every 5 minutes
  ...mediaJobs,        // media.sweep        — daily 04:15 UTC; media.purge — every 15 minutes; media.orphans — daily 04:45 UTC
  ...maintenanceJobs,  // ratelimit.cleanup  — daily 03:30 UTC
  ...importJobs,       // import.sources     — every 30 minutes; import.news.prune — daily
  ...embedJobs,        // embeds.refresh     — every 30 minutes
  ...opsJobs,          // ops.watchdog       — every minute; backup.database — daily 02:40 UTC (BACKUP_ENABLED=true)
  ...blogJobs,         // blog.notifications — every minute; transactional outbox delivery
];
const PART = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/;
/** Five-field cron ("m h dom mon dow"), numbers only — the subset the registry allows. */
export const validCron = (pattern: string) => {
  const fields = pattern.trim().split(/\s+/), max = [59, 23, 31, 12, 7], min = [0, 0, 1, 1, 0];
  return fields.length === 5 && fields.every((field, index) => field.split(',').every(part => {
    const match = PART.exec(part);
    if (!match) return false;
    const [from, to, step] = [match[1], match[2], match[3]].map(value => value === undefined ? undefined : Number(value));
    const inRange = (value: number | undefined) => value === undefined || (value >= min[index] && value <= max[index]);
    return inRange(from) && inRange(to) && (from === undefined || to === undefined || from <= to) && (step === undefined || step > 0);
  }));
};
/** Problems that would make the worker misbehave; empty when the registry is sound. Checked on boot and in tests. */
export function registryProblems(list: readonly JobDef[] = jobs): string[] {
  const problems: string[] = [], seen = new Set<string>();
  for (const job of list) {
    if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(job.name)) problems.push('bad name: ' + job.name);
    if (seen.has(job.name)) problems.push('duplicate name: ' + job.name);
    seen.add(job.name);
    if (job.cron !== undefined && job.everyMs !== undefined) problems.push(job.name + ': both cron and everyMs');
    if (job.cron !== undefined && !validCron(job.cron)) problems.push(job.name + ': invalid cron "' + job.cron + '"');
    if (job.everyMs !== undefined && (!Number.isInteger(job.everyMs) || job.everyMs < 1000)) problems.push(job.name + ': everyMs must be a whole number of at least 1000');
    if (job.attempts !== undefined && (!Number.isInteger(job.attempts) || job.attempts < 1 || job.attempts > 10)) problems.push(job.name + ': attempts must be 1…10');
    if (typeof job.handler !== 'function') problems.push(job.name + ': no handler');
  }
  return problems;
}
