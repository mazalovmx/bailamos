# Cities and dance styles

The expanded dataset defines 97 cities and 291 styles in a parentId tree. pnpm db:seed matches by slug without overwriting existing records, preserving administrative edits. Available cities are not a promise of events in each location.

## Data sources

- packages/db/prisma/data/styles.ts: styleTree; parents precede children. Unknown parents/cycles are rejected.
- packages/db/prisma/data/cities.ts: slug, local name, ISO country code, IANA zone and centre coordinates.
- packages/db/prisma/catalogue-additions.ts: earlier entries retained for compatibility with existing tests and included in the larger lists.

Slugs are permanent identifiers, matching seeded IDs. URLs, filters and city cookies depend on them. Existing slugs, including mexico-city, madrid, moscow and the Swing family, are preserved.

## Cities and styles

Cities cover Europe, the Americas, CIS and selected locations elsewhere. Coordinates are approximate centres, not venues. IANA zones are validated during seeding and tests. [IANA database](https://www.iana.org/time-zones). Names use local spellings; autocomplete also searches slugs, so moscow, lisbon, cologne and bogota work.

Root style families include Salsa, Bachata, Tango, Kizomba, Swing, Zouk, Forró, Brazilian, Afro-Cuban, Merengue, Cumbia, Latin urban, Konpa, Ballroom (Standard/Latin/American Smooth/American Rhythm), Hustle, Discofox, Blues, Tap, Fusion, Country & Western, Folk & traditional, Flamenco, Hip-hop & street dance, Afro dance, Contemporary, Jazz dance, Ballet, Oriental, Indian, Polynesian and Historical. Canonical proper names are not translated.

Blues and Tap are independent neighbours, not Lindy Hop substyles. West Coast Swing remains under Swing to preserve its existing identity. The grouping is navigation, not an exhaustive historical classification.

References: [Herräng](https://www.herrang.com/2026/courses), [Brisbane Balboa Swing](https://brisbanebalboaswing.dance/), [World Swing Dance Council](https://worldsdc.com/about/), [Carolina Shag clubs](https://shagdance.com/acscpage.htm).

## Navigation

- /[locale]/styles: searchable tree. /[locale]/styles/[slug]: descendants, upcoming published events and following. A chosen home city narrows events unless ?everywhere=1 is used.
- /[locale]/cities: country-grouped directory, active event counts and home-city selection. /[locale]/cities/[slug]: daily programme in the city's time zone, calendar/map/iCal links and following.
- The city cookie stores a slug for one year with SameSite=Lax. Server helpers: currentCitySlug()/currentCity() in lib/catalogue/current-city.ts.
- upcomingOccurrences() in lib/catalogue/data.ts returns published, non-hidden, non-cancelled future occurrences.

## Autocomplete and following

GET /api/catalogue/styles?q= and /api/catalogue/cities?q= return at most ten matches, ranked by exact match, name/slug prefix, word prefix and substring. Matching ignores case/diacritics; responses use public, max-age=300.

StyleAutocomplete and CityAutocomplete expose ARIA comboboxes and submit IDs through hidden inputs. Multiple style selection submits one input per style.

PUT/DELETE /api/follows accept exactly one target: cityId, styleId or profileId. GET returns the caller's subscriptions. Duplicate follows are idempotent. A new profile follow sends one NEW_FOLLOWER notification; self-following and following hidden profiles are forbidden.

## Discovery filters

Long option lists support internal search without clearing selections or changing the global event query. Select matching options adds to existing selections. Hidden checked options still submit. Diacritics are optional.

The synchronous eventSearch() retains static Swing-family expansion for isolated callers/tests. Public pages should use eventSearchAll(), which expands each selected style through the full database tree and combines the results without duplicates. Integration status is tracked in the epic audit.
