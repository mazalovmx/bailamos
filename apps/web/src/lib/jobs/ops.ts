import type {JobDef} from '../../worker/types';
import {runWatchdog} from '../ops/alerts';
import {backupDatabase} from '../ops/backup';
export const opsJobs: JobDef[] = [
  // Error rates, worker heartbeat, database, Redis and backup freshness; alerts go to ALERT_WEBHOOK_URL / ALERT_EMAIL.
  {name: 'ops.watchdog', everyMs: 60_000, attempts: 1, handler: () => runWatchdog()},
  // 02:40 UTC. Railway's volume backups are the primary mechanism; this one is opt-in (BACKUP_ENABLED=true).
  {name: 'backup.database', cron: '40 2 * * *', attempts: 2, handler: async () => process.env.BACKUP_ENABLED === 'true' ? backupDatabase() : {skipped: 'DISABLED' as const}}
];
