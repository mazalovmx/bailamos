// Contract between feature modules and the BullMQ worker process (src/worker/index.ts).
// A feature exports JobDef[]; the worker registers each one as a repeatable job on the shared Redis.
export type JobDef = {
  name: string;
  // Repeat schedule: either a fixed interval or a cron pattern (UTC). Omit both for on-demand jobs.
  everyMs?: number;
  cron?: string;
  attempts?: number;
  handler: (data: Record<string, unknown>) => Promise<unknown>;
};
