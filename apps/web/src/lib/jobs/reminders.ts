import type {JobDef} from '../../worker/types';
// The reminders module belongs to the notifications feature. The specifier is a variable so this file still
// compiles and the worker still boots when that feature is not deployed.
const REMINDERS_MODULE = '../notifications/reminders';
type SendReminders = (now?: Date, intervalMinutes?: number) => Promise<unknown>;
const missing = (error: unknown) => ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes((error as {code?: string})?.code || '');
/** Resolves to null when the notifications feature is absent; any other load error propagates. */
export async function loadReminders(specifier = REMINDERS_MODULE): Promise<SendReminders | null> {
  try {
    const feature: {sendEventReminders?: SendReminders} = await import(specifier);
    return typeof feature.sendEventReminders === 'function' ? feature.sendEventReminders : null;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
export async function runEventReminders() {
  const send = await loadReminders();
  return send ? send(new Date(), 5) : {skipped: 'MODULE_ABSENT' as const};
}
export const reminderJobs: JobDef[] = [
  // Every 5 minutes, matching the window sendEventReminders() expects; occurrences are claimed atomically there.
  {name: 'reminders.events', everyMs: 5 * 60_000, attempts: 2, handler: runEventReminders}
];
