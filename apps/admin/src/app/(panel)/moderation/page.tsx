import {ModerationQueue} from '../../../components/moderation-queue';
import {pageStaff} from '../../../lib/guard';
export default async function Moderation() {
  await pageStaff();
  return <ModerationQueue/>;
}
