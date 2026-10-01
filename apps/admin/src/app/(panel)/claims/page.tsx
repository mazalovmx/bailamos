import {Claims} from '../../../components/claims';
import {pageStaff} from '../../../lib/guard';
export default async function ClaimsPage() {
  await pageStaff();
  return <Claims/>;
}
