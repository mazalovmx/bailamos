import {actor, apiError, jsonBody} from '../../../lib/api';
import {createReport, ModerationError, reportSchema} from '../../../lib/moderation';
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    const input = reportSchema.parse(await jsonBody(request));
    const result = await createReport({id: user.id, profileId: user.profile?.id}, input);
    return Response.json(result, {status: result.created ? 201 : 200});
  } catch (error) {
    if (error instanceof ModerationError) return Response.json({error: error.code}, {status: error.status});
    return apiError(error);
  }
}
