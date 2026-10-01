import {notFound} from 'next/navigation';
import {ResourceForm} from '../../../../../components/resource-form';
import {pageStaff} from '../../../../../lib/guard';
import {allows, resources} from '../../../../../lib/resources';
export default async function Record({params}: {params: Promise<{resource: string; id: string}>}) {
  const user = await pageStaff();
  const {resource: name, id} = await params, item = resources.find(candidate => candidate.name === name);
  if (!item || (id === 'new' && !allows(item.create, user.role))) notFound();
  return <ResourceForm key={name + ':' + id} name={name} id={id === 'new' ? undefined : decodeURIComponent(id)}/>;
}
