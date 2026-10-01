import {Shell} from '../../components/shell';
import {webOrigin} from '../../lib/env';
import {pageStaff} from '../../lib/guard';
import {resourceMeta} from '../../lib/resources';
// Every panel page renders inside this layout; pages repeat the guard because layouts are not re-run on client navigation.
export default async function PanelLayout({children}: {children: React.ReactNode}) {
  const user = await pageStaff();
  return <Shell user={user} meta={resourceMeta(user.role)} webUrl={webOrigin()}>{children}</Shell>;
}
