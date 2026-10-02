# UX audit — 1 October 2026

Scope: every page reachable without signing in (crawl of 400 URLs in en/es/ru) and two journeys driven through a real headless browser with screenshots: a dancer looking for events, and a school owner creating weekly classes and one workshop. Reproduce with `pnpm exec tsx scripts/audit-journeys.ts` from `apps/web` against a running build (see the header of that script); screenshots land in `test-results/audit`.

## Crawl

400 pages, no 4xx/5xx, no missing headings or titles, no raw translation keys or `undefined` in the text. The only redirects were `/events/new` → sign-in.

## Fixed in this pass

| Problem | Where it hurt | Fix |
| --- | --- | --- |
| "Sign in to RSVP" dropped the visitor on the account page after signing in; the event had to be found again. Same after creating a profile, and for "Create event" | Dancer journey | Sign-in and onboarding carry a return address |
| Onboarding showed all 291 styles as one wall of checkboxes | Both journeys | Swing family first, the rest behind "All other styles" |
| Onboarding asked a school for its dance role and level; a school had to register as a dancer first and then change the profile type | School journey | First question is "who is this account for"; a school or organizer skips the dance questions and lands on its own page |
| A school owner's own page had no way to add a class; the account home offered nothing about classes | School journey | "Add a class or event" on the school page; two school cards on the account home |
| A new school looked empty: classes that start next week did not show and nothing said so | School journey | The empty week links to the first week that has classes |
| School page header: name pushed to the far right of the avatar | School page | Alignment fixed |
| `/api/chat/unread` answered 409 on every page for an account without a profile; `/favicon.ico` was a 404 | Console errors on every page | Counter answers zero; favicon redirects to the icon |
| Account, events, new event, event editor and "My events" had no page title of their own | Browser tabs, history | Titles added |
| The public agenda was labelled "Community preview" | Events page | Label replaced |

After the fixes both journeys run with no console errors and no failed requests.

## Open — needs a product decision

1. **A weekly series floods the agenda.** Six dates of one class take six identical cards, and a single workshop is lost among them. Options: one card per series with "next date + N more", or group by day.
2. **`/classes` is empty when a city's first classes start next week.** The school page now points to the right week; the city timetable does not.
3. **The install prompt sits over content** on every page until dismissed, on phones it covers the calendar buttons of an event.
4. **A school keeps dance skills** (role, level, "looking for a partner") in its profile editor if it was created as a dancer first.
5. **Event page wording for non-classes**: the block is titled "About this class" for a workshop or a social; the time reads "Monday … 7:00 PM — Monday … 8:00 PM" with the date repeated.
6. **"Create event" is the main button of the agenda** for an anonymous visitor, who came to find events, not to create one.
7. **The "Report" control is unstyled** on the event page.
8. **Venues**: a city without venues sends the organizer to a new tab to add one; coming back requires "Refresh the list".

## Not covered

Admin panel screens, chat between two live users, the announcement parser with a real model key, push, PWA installation, and anything on a real phone. Screens were checked at 1280 px and 390 px only.

## Signed-in pass — 2 October 2026

Run with `pnpm exec tsx scripts/audit-full.ts` from `apps/web`. It signs in with the `login` / `password` entries of `.env` (never printed), crawls the site and the admin panel as that account, and drives ten scenarios in a headless browser with throwaway accounts that it deletes afterwards.

Crawl: 450 site pages as the owner account, 120 as a school owner, 26 admin pages — no errors, no redirects to sign-in, no broken text.

Scenarios that pass end to end: co-organizer invitation (notification → invitation page → accept → editor), cancelling one date of a series, creating an artist without a profile and its claimable page, writing and publishing a post (public page, RSS), following a school and a city and the feed, a message request (accept, reply), partner search with mutual interest and its notification, report → admin moderation queue, data export, the announcement parser against the real model, short link, .ics file, city calendar feed, twelve pages at phone width.

Fixed in this pass:

| Problem | Fix |
| --- | --- |
| Twelve personal pages (account, messages, notifications, settings, posts, profile, my events, editors) sent a signed-out visitor to sign-in without the way back | All of them return to the page that asked |
| Posts, new post, post editor, invitation, announcement studio, sign-in and registration had no page title | Titles added |
| An accepted invitation stayed an unread notification | It is marked read when answered |
| The parser left the event type on "Class" for a social and failed to place "venue name, street, city" on the map | The type is read from the text; the street address is geocoded first |
| The admin panel asked for a missing favicon on every page | Icon added |

Not a defect, by design: no notification about a chat reply while the recipient was in the conversation less than a minute ago.

Still open, in addition to the list above: the admin panel was crawled and its queue opened, but no moderation decision was applied.

## Event place — 2 October 2026

The announcement parser was removed at the product owner's request, so the parser findings above no longer apply. The new-event form now has one place block: country → city → address or venue, or a click on the map that fills in city and country. An exact marker is required. Scenario S9 of `audit-full.ts` covers it: a map click sets the marker and the city, the event is saved with coordinates, address and map note, and the public page and the map card endpoint show the note. Both audit scripts pass with no findings.

Map photo check (`pnpm exec tsx scripts/audit-mapcard.ts`): upload in the form, preview, saved key, served file, editor, event page, and the popup on the public map at 1280 and 390 px. It found two defects, both fixed: the upload of a map photo was refused (the raw key pattern did not know the `eventmap` target), and the popup was cut off by the map edge and by its own 260 px height limit (the map now pans so the whole popup is visible).
