// Bootstraps platform access: pnpm --filter @dance/db exec dotenv -e ../../.env -- tsx prisma/grant-role.ts <email> <OWNER|ADMIN|MODERATOR|USER>
import {db, UserRole} from '../src/index';
const [email, role] = process.argv.slice(2);
async function main() {
  if (!email || !role || !(role in UserRole) || role === 'SCHOOL_ADMIN') {
    console.error('Usage: tsx prisma/grant-role.ts <email> <OWNER|ADMIN|MODERATOR|USER>. Assign school access through its team, with a school scope.');
    return 1;
  }
  const user = await db.user.findUnique({where: {email: email.toLowerCase()}, select: {id: true, role: true, emailVerified: true, bannedAt: true}});
  if (!user) {
    console.error('No user with this email. Register in the web app first, then run the command again.');
    return 1;
  }
  await db.$transaction([
    db.user.update({where: {id: user.id}, data: {role: role as UserRole}}),
    db.session.deleteMany({where: {userId: user.id}}),
    db.auditLog.create({data: {actorUserId: null, action: 'USER_ROLE', targetType: 'User', targetId: user.id, data: {from: user.role, to: role, via: 'cli'}}})
  ]);
  console.log(email.toLowerCase() + ': ' + user.role + ' -> ' + role);
  if (!user.emailVerified) console.warn('Google must verify this exact email on sign-in. Email/password access requires an already verified address.');
  if (user.bannedAt) console.warn('Warning: the user is banned; the admin panel refuses banned accounts.');
  return 0;
}
main().catch(error => {console.error(error instanceof Error ? error.message : error); return 1;})
  .then(async code => {await db.$disconnect(); process.exitCode = code;});
