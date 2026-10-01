import {notFound} from 'next/navigation';
import {ResourceList} from '../../../../components/resource-list';
import {pageStaff} from '../../../../lib/guard';
import {resources} from '../../../../lib/resources';
type Props = {params: Promise<{resource: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>};
export default async function List({params, searchParams}: Props) {
  await pageStaff();
  const {resource: name} = await params, item = resources.find(candidate => candidate.name === name);
  if (!item) notFound();
  // Links such as "messages of this conversation" arrive with filters in the query string; only filterable columns are accepted.
  const initial = Object.fromEntries(Object.entries(await searchParams).flatMap(([key, value]) =>
    typeof value === 'string' && item.fields.some(field => field.filter && field.name === key.split('__')[0]) ? [[key, value]] : []));
  return <ResourceList key={name + JSON.stringify(initial)} name={name} initial={initial}/>;
}
