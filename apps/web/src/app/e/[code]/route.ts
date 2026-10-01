import {db} from '@dance/db';
import {routing} from '../../../i18n/routing';
import {siteUrl} from '../../../lib/mail';
import {publicEvent} from '../../../lib/events/access';
import {preferredLocale, shortCodePattern} from '../../../lib/events/short-code';
export const dynamic='force-dynamic';
// Short link /e/<code> → the event page in the visitor's language (Accept-Language) or the default one.
export async function GET(request:Request,{params}:{params:Promise<{code:string}>}) {
  const code=(await params).code.toLowerCase();
  const event=shortCodePattern.test(code)?await db.event.findFirst({where:{shortCode:code,...publicEvent},select:{slug:true}}):null;
  if (!event) return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','X-Robots-Tag':'noindex'}});
  const locale=preferredLocale(request.headers.get('accept-language'),routing.locales,routing.defaultLocale);
  // The target depends on the visitor's language, so shared caches must not reuse it for everyone.
  return new Response(null,{status:308,headers:{Location:siteUrl()+'/'+locale+'/events/'+event.slug,Vary:'Accept-Language','Cache-Control':'private, max-age=300'}});
}
