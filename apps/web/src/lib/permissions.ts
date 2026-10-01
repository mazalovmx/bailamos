import {AbilityBuilder, createMongoAbility} from '@casl/ability';
export function eventAbility(profileId: string | undefined, members: {profileId: string; role: string}[]) {
  const {can, build} = new AbilityBuilder(createMongoAbility);
  if (profileId && members.some(m => m.profileId === profileId && ['OWNER','CO_ORGANIZER'].includes(m.role))) can('manage', 'Event');
  return build();
}
