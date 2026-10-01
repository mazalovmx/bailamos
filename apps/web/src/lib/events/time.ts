// Pure helpers shared by the server page and the small client component that shows the viewer's own time.
const wall=(date:Date,zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
// Two zones "differ" for an event only if their clocks show something else at that instant (Madrid and Paris do not).
export function sameWallClock(date:Date,zoneA:string,zoneB:string) {
  try{return wall(date,zoneA)===wall(date,zoneB);}catch{return true;}
}
export function zonedLabel(date:Date,locale:string,zone:string) {
  return new Intl.DateTimeFormat(locale,{dateStyle:'full',timeStyle:'short',timeZone:zone}).format(date);
}
// "19:00 GMT+2"-style short zone name next to an explicit zone id, so the reader never has to guess.
export function zoneName(date:Date,locale:string,zone:string) {
  return new Intl.DateTimeFormat(locale,{timeZone:zone,timeZoneName:'short'}).formatToParts(date).find(part=>part.type==='timeZoneName')?.value||zone;
}
