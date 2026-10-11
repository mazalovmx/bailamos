import {db} from '@dance/db';
import {actor, apiError, ApiError} from '../../../../../lib/api';
import {isSocialProvider} from '../../../../../lib/account/social-providers';

export async function DELETE(request: Request, {params}: {params: Promise<{provider: string}>}) {
  try {
    const user = await actor(request), {provider} = await params;
    if (!isSocialProvider(provider)) throw new ApiError('PROVIDER_NOT_FOUND', 404);
    await db.$transaction(async tx => {
      const accounts = await tx.account.findMany({where: {userId: user.id}, select: {id: true, providerId: true, password: true}});
      const linked = accounts.filter(account => account.providerId === provider);
      if (!linked.length) throw new ApiError('SOCIAL_ACCOUNT_NOT_LINKED', 404);
      // A password remains even if all social accounts are subsequently disconnected.
      if (!accounts.some(account => account.providerId === 'credential' && !!account.password)) throw new ApiError('LAST_SIGN_IN_METHOD', 409);
      await tx.account.deleteMany({where: {userId: user.id, id: {in: linked.map(account => account.id)}}});
    });
    return Response.json({linked: false}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return apiError(error);}
}
