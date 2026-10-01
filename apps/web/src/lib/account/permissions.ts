import {AbilityBuilder, createMongoAbility, subject} from '@casl/ability';
type Owned = {userId: string | null};
// A profile can be changed only by the account that owns it. Stub profiles (userId null) are changed through claims and the admin panel.
export function profileAbility(userId: string | undefined | null) {
  const {can, build} = new AbilityBuilder(createMongoAbility);
  can('read', 'Profile');
  if (userId) {
    can(['update', 'delete'], 'Profile', {userId});
    can('claim', 'Profile', {userId: null});
  }
  return build();
}
export const canEditProfile = (userId: string | undefined | null, profile: Owned) =>
  profileAbility(userId).can('update', subject('Profile', {userId: profile.userId}));
export const canClaimProfile = (userId: string | undefined | null, profile: Owned) =>
  profileAbility(userId).can('claim', subject('Profile', {userId: profile.userId}));
