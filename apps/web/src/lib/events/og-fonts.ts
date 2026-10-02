import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
// The font built into next/og covers Latin only, so Cyrillic titles came out as empty boxes. PT Sans (SIL Open Font
// License 1.1, see apps/web/assets/fonts/OFL.txt) is bundled instead: Latin with Spanish accents and Cyrillic,
// regular and bold. The files are read once per server process, from the application directory.
export const ogFontFamily='PT Sans';
const load=(file:string)=>readFile(join(process.cwd(),'assets/fonts',file));
type Font={name:string;data:Buffer;weight:400|700;style:'normal'};
let loaded:Promise<Font[]>|null=null;
export function ogFonts() {
  return loaded??=Promise.all([load('PT_Sans-Web-Regular.ttf'),load('PT_Sans-Web-Bold.ttf')])
    .then(([regular,bold]):Font[]=>[{name:ogFontFamily,data:regular,weight:400,style:'normal'},{name:ogFontFamily,data:bold,weight:700,style:'normal'}]);
}
// Intl puts narrow and non-breaking spaces into dates; a plain space is in every font.
const spaces=new RegExp('['+String.fromCharCode(0xa0,0x2007,0x2009,0x202f)+']','g');
export const plainSpaces=(text:string)=>text.replace(spaces,' ');
