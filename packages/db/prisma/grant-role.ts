// Bootstraps staff access: pnpm --filter @dance/db exec dotenv -e ../../.env -- tsx prisma/grant-role.ts <email> <ADMIN|MODERATOR|USER>
import {db, UserRole} from '../src/index';
const [email, role] = process.argv.slice(2);
async function main() {
  if (!email || !role || !(role in UserRole)) {
    console.error('Usage: tsx prisma/grant-role.ts <email> <ADMIN|MODERATOR|USER>');
    return 1;
  }
  const user = await db.user.findUnique({where: {email: email.toLowerCase()}, select: {id: true, role: true, emailVerified: true, bannedAt: true}});
  if (!user) {
    console.error('No user with this email. Register in the web app first, then run the command again.');
    return 1;
  }
  await db.$transaction([
    db.user.update({where: {id: user.id}, data: {role: role as UserRole}}),
    db.auditLog.create({data: {actorUserId: null, action: 'USER_ROLE', targetType: 'User', targetId: user.id, data: {from: user.role, to: role, via: 'cli'}}})
  ]);
  console.log(email.toLowerCase() + ': ' + user.role + ' -> ' + role);
  if (!user.emailVerified) console.warn('Warning: the email is not verified; the admin panel refuses sign-in until it is.');
  if (user.bannedAt) console.warn('Warning: the user is banned; the admin panel refuses banned accounts.');
  return 0;
}
main().catch(error => {console.error(error instanceof Error ? error.message : error); return 1;})
  .then(async code => {await db.$disconnect(); process.exitCode = code;});
