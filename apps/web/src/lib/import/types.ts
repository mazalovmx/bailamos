// One shape for everything the parsers read from RSS, iCal and Schema.org. All strings are already plain text.
export type ImportRecurrence = {count?: number; interval: number; byDay: string[]; until?: string};
export type ParsedEvent = {
  externalId: string;
  title: string;
  description?: string;
  // An absolute instant (UTC). Absent when the source gave a wall-clock time without an offset: then `startsLocal`
  // ("yyyy-MM-dd'T'HH:mm") is set and the pipeline places it in the timezone of the resolved city.
  startsAt?: Date;
  endsAt?: Date;
  startsLocal?: string;
  endsLocal?: string;
  allDay?: boolean;
  timezone?: string;
  venueName?: string;
  address?: string;
  lat?: number;
  lng?: number;
  url?: string;
  // The source rule as text (informational). `recurrence` is set only when it maps onto lib/schedule.ts;
  // other rules arrive expanded in `occurrences`, or flagged in `review`.
  rrule?: string;
  recurrence?: ImportRecurrence;
  occurrences?: {startsAt: Date; endsAt?: Date}[];
  cancelled?: boolean;
  review?: string;
};
export type ParsedNews = {url: string; title: string; summary?: string; publishedAt: Date};
export const MAX_ITEMS = 300;
