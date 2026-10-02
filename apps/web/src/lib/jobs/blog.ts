import type {JobDef} from '../../worker/types';
import '../notifications/register';
import {drainPostNotificationOutbox} from '../blog/outbox';
export const blogJobs: JobDef[] = [
  {name: 'blog.notifications', everyMs: 60_000, attempts: 3, handler: drainPostNotificationOutbox}
];
