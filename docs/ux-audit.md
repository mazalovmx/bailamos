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
