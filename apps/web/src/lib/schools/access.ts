import {db, schoolIdsFor} from '@dance/db';
// Schools a user manages on the site: those granted in the admin panel (SchoolAdmin) and a SCHOOL profile they own.
// The grant is read from the database on every request, so a revocation takes effect at once.
export async function managedSchoolIds(userId: string): Promise<string[]> {
  return schoolIdsFor(userId);
}
export const managesSchool = (user: {schoolIds?: string[]} | null | undefined, schoolProfileId: string | null | undefined) =>
  !!schoolProfileId && !!user?.schoolIds?.includes(schoolProfileId);
export async function managedSchools(schoolIds: string[]) {
  return schoolIds.length ? db.profile.findMany({where: {id: {in: schoolIds}, type: 'SCHOOL', hiddenAt: null},
    select: {id: true, name: true}, orderBy: {name: 'asc'}}) : [];
}
