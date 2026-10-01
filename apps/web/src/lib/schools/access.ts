import {db} from '@dance/db';
// Schools a user manages on the site: those granted in the admin panel (SchoolAdmin) and a SCHOOL profile they own.
// The grant is read from the database on every request, so a revocation takes effect at once.
export async function managedSchoolIds(userId: string): Promise<string[]> {
  const [grants, own] = await Promise.all([
    db.schoolAdmin.findMany({where: {userId}, select: {schoolProfileId: true}}),
    db.profile.findFirst({where: {userId, type: 'SCHOOL'}, select: {id: true}})]);
  return [...new Set([...grants.map(grant => grant.schoolProfileId), ...(own ? [own.id] : [])])];
}
export const managesSchool = (user: {schoolIds?: string[]} | null | undefined, schoolProfileId: string | null | undefined) =>
  !!schoolProfileId && !!user?.schoolIds?.includes(schoolProfileId);
export async function managedSchools(schoolIds: string[]) {
  return schoolIds.length ? db.profile.findMany({where: {id: {in: schoolIds}, type: 'SCHOOL', hiddenAt: null},
    select: {id: true, name: true}, orderBy: {name: 'asc'}}) : [];
}
