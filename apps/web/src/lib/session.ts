import {cache} from 'react';
import {headers} from 'next/headers';
import {auth} from './auth';
import {db} from '@dance/db';
export const currentUser = cache(async () => {
  const session = await auth.api.getSession({headers: await headers()});
  if (!session) return null;
  const profile = await db.profile.findUnique({where: {userId: session.user.id}, include: {skills: true}});
  return {...session.user, profile};
});
