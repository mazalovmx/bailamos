import {DateTime} from 'luxon';
// ISO 8601 with the event's own UTC offset, as Schema.org and Open Graph expect: 2030-06-14T19:00:00+02:00.
export function offsetIso(date:Date,zone:string) {
  return DateTime.fromJSDate(date,{zone}).toISO({suppressMilliseconds:true})!;
}
type Person={name:string;handle:string;type:string};
export type JsonLdEvent={title:string;description:string|null;status:string;timezone:string;priceText:string|null;lat:number|null;lng:number|null;
  city:{name:string;countryCode:string};venue:{name:string;address:string;lat:number;lng:number;hiddenAt:Date|null}|null};
const party=(origin:string)=>(p:Person)=>({'@type':p.type==='SCHOOL'||p.type==='ORGANIZER'||p.type==='VENUE'?'Organization':'Person',name:p.name,url:origin+'/@'+p.handle});
// Schema.org Event for one date of the event. Only what the page already shows publicly goes in.
export function eventJsonLd(event:JsonLdEvent,when:{startsAt:Date;endsAt:Date|null;cancelled:boolean},people:{organizers:Person[];artists:Person[]},links:{origin:string;url:string;image?:string}) {
  const venue=event.venue&&!event.venue.hiddenAt?event.venue:null;
  const address={'@type':'PostalAddress',...(venue?{streetAddress:venue.address}:{}),addressLocality:event.city.name,addressCountry:event.city.countryCode.trim()};
  return {
    '@context':'https://schema.org','@type':'Event',name:event.title,url:links.url,
    ...(event.description?{description:event.description.slice(0,500)}:{}),
    startDate:offsetIso(when.startsAt,event.timezone),...(when.endsAt?{endDate:offsetIso(when.endsAt,event.timezone)}:{}),
    eventStatus:'https://schema.org/'+(event.status==='CANCELLED'||when.cancelled?'EventCancelled':'EventScheduled'),
    eventAttendanceMode:'https://schema.org/OfflineEventAttendanceMode',
    location:{'@type':'Place',name:venue?.name||event.city.name,address,
      // Exact coordinates are published for a venue only; a city-level event has no precise point.
      ...(venue?{geo:{'@type':'GeoCoordinates',latitude:venue.lat,longitude:venue.lng}}:{})},
    ...(people.organizers.length?{organizer:people.organizers.map(party(links.origin))}:{}),
    ...(people.artists.length?{performer:people.artists.map(party(links.origin))}:{}),
    ...(links.image?{image:[links.image]}:{})
  };
}
// Safe inside <script type="application/ld+json">: no "<" survives, so user text cannot close the element.
// The two Unicode line separators are escaped too: legal in JSON, but a line end for older script parsers.
const separators=new RegExp('['+String.fromCharCode(0x2028,0x2029)+']','g');
export const safeJson=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c').replace(separators,c=>'\\u'+c.charCodeAt(0).toString(16));
