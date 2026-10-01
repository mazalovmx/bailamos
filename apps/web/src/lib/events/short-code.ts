import {randomBytes} from 'node:crypto';
import {db, Prisma} from '@dance/db';
// RFC 4648 base32 alphabet, lower case: 32 symbols, so one random byte maps to a symbol without bias.
const alphabet='abcdefghijklmnopqrstuvwxyz234567';
export const shortCodePattern=/^[a-z2-7]{6,8}$/;
export function newShortCode(length=7) {
  return [...randomBytes(length)].map(byte=>alphabet[byte&31]).join('');
}
// Gives the event a short code once (on first publication) and returns it. A collision with another
// event's code is caught by the unique index and retried with a fresh code.
export async function ensureShortCode(eventId:string,generate:()=>string=newShortCode,attempts=8) {
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      await db.event.updateMany({where:{id:eventId,shortCode:null},data:{shortCode:generate()}});
      return (await db.event.findUnique({where:{id:eventId},select:{shortCode:true}}))?.shortCode??null;
    }catch(error){
      if(!(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')) throw error;
    }
  }
  throw new Error('SHORT_CODE_UNAVAILABLE');
}
// Picks the interface language for a short link from Accept-Language; q-values are respected.
export function preferredLocale(header:string|null,locales:readonly string[],fallback:string) {
  const wanted=(header||'').split(',').map(part=>{
    const [tag,...params]=part.trim().split(';'),q=params.map(p=>p.trim()).find(p=>p.startsWith('q='));
    return {tag:tag.toLowerCase().split('-')[0],q:q?Number(q.slice(2)):1};
  }).filter(item=>item.tag&&Number.isFinite(item.q)&&item.q>0).sort((a,b)=>b.q-a.q);
  return wanted.map(item=>item.tag).find(tag=>locales.includes(tag))||fallback;
}
