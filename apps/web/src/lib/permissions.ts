import {AbilityBuilder, createMongoAbility} from '@casl/ability';
// Actions on an event:
//   manage  — edit, publish, cancel, single dates, artists (OWNER and CO_ORGANIZER);
//   delete  — remove the event for good (OWNER only);
//   team    — invite, list and remove co-organizers (OWNER only).
// "manage" is CASL's wildcard, so the owner-only actions are taken back from co-organizers explicitly.
export function eventAbility(profileId: string | undefined, members: {profileId: string; role: string}[]) {
  const {can, cannot, build} = new AbilityBuilder(createMongoAbility);
  const roles = profileId ? members.filter(m => m.profileId === profileId).map(m => m.role) : [];
  if (roles.includes('OWNER')) can('manage', 'Event');
  else if (roles.includes('CO_ORGANIZER')) {
    can('manage', 'Event');
    cannot('delete', 'Event');
    cannot('team', 'Event');
  }
  return build();
}
export const organizerRoles = ['OWNER', 'CO_ORGANIZER'] as const;
