# Cities and dance styles

The expanded dataset defines 97 cities and 291 styles in a parentId tree. pnpm db:seed matches by slug without overwriting existing records, preserving administrative edits; the only column it refreshes on existing cities is `names` (see Localized city names). Available cities are not a promise of events in each location.

## Data sources

- packages/db/prisma/data/styles.ts: styleTree; parents precede children. Unknown parents/cycles are rejected.
- packages/db/prisma/data/cities.ts: slug, local name, en/es/ru names, ISO country code, IANA zone and centre coordinates. A city without localized names fails the seed.
- packages/db/prisma/catalogue-additions.ts: earlier entries retained for compatibility with existing tests and included in the larger lists.

Slugs are permanent identifiers, matching seeded IDs. URLs, filters and city cookies depend on them. Existing slugs, including mexico-city, madrid, moscow and the Swing family, are preserved.

## Cities and styles

Cities cover Europe, the Americas, CIS and selected locations elsewhere. Coordinates are approximate centres, not venues. IANA zones are validated during seeding and tests. [IANA database](https://www.iana.org/time-zones). `City.name` keeps the local spelling; autocomplete searches it, the three localized names and the slug, so moscow, Moscú, Москва, cologne, Köln and Кёльн all work.

Root style families include Salsa, Bachata, Tango, Kizomba, Swing, Zouk, Forró, Brazilian, Afro-Cuban, Merengue, Cumbia, Latin urban, Konpa, Ballroom (Standard/Latin/American Smooth/American Rhythm), Hustle, Discofox, Blues, Tap, Fusion, Country & Western, Folk & traditional, Flamenco, Hip-hop & street dance, Afro dance, Contemporary, Jazz dance, Ballet, Oriental, Indian, Polynesian and Historical. Canonical proper names are not translated.

Blues and Tap are independent neighbours, not Lindy Hop substyles. West Coast Swing remains under Swing to preserve its existing identity. The grouping is navigation, not an exhaustive historical classification.

References: [Herräng](https://www.herrang.com/2026/courses), [Brisbane Balboa Swing](https://brisbanebalboaswing.dance/), [World Swing Dance Council](https://worldsdc.com/about/), [Carolina Shag clubs](https://shagdance.com/acscpage.htm).

## Localized city names

`City.names` is JSON `{en, es, ru}` (Moscow / Moscú / Москва, Cologne / Colonia / Кёльн); `City.name` is the local spelling and the fallback. Helpers in lib/catalogue/city-name.ts (pure, usable in client components):

- `cityName(city, locale)`: the name for the interface language; a missing or malformed value yields `city.name`.
- `cityAliases(city)`: every spelling, for search.
- `localizeCities(cities, locale)`: replaces `name`, keeps the stored one as `localName`, sorts for the locale. `localizedCities(locale)` in lib/catalogue/data.ts does this for the cached city list.
- `catalogue(locale)` in lib/catalogue.ts returns city names in that language; without the argument they stay local.

Any query that prints a city must select `names` next to `name` and pass both to `cityName`. GET /api/catalogue/cities accepts `locale=en|es|ru`: `name` is then localized and `localName` holds the stored spelling; without it `name` stays local. CityAutocomplete sends the interface language itself; pass it an already localized `initialName`.

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

## Site search

PostgreSQL full-text search replaces Meilisearch (allowed by the specification). Code: lib/search/text.ts (pure helpers), lib/search/search.ts (SQL), app/api/search, app/[locale]/search, components/search.

GET /api/search?q=&type=events|people|schools|posts|venues|all&city=&cursor=&limit=&locale=

- `q`: at least one word of two letters or digits, at most 100 characters; otherwise 400 QUERY_TOO_SHORT.
- `type`: `all` (default) returns the first five hits of every type; a single type returns pages of twenty. `counts` always holds the totals of all five types.
- `city`: city id or slug; unknown values give 400 CITY_NOT_FOUND. `cursor`: the `nextCursor` of the previous page (an offset, at most 1000). `limit`: 1–20. `locale`: language of city names.
- Each hit has `path` (without the locale prefix), `title` and `snippet` as segments `{text, hit?}`. Segments are plain text: the server never returns HTML and the client renders them through React (`<Highlight>`), so stored markup cannot execute.
- 90 requests a minute per address and per account; then 429 RATE_LIMITED with Retry-After. Responses are `private, no-store` because they depend on the viewer's blocks.

What is searched: events (title, description), profiles (name, handle, bio; `schools` are profiles of type SCHOOL, `people` all the others), posts (title, excerpt), venues (name, address). Only public rows: published, non-hidden events (cancelled ones are left out); non-hidden profiles of non-banned users, minus anyone in a block relation with the signed-in viewer; published, non-hidden posts of such authors; non-hidden venues. Coordinates, emails and user ids are never selected.

Matching and ranking:

- `websearch_to_tsquery('simple', q)` handles quoted phrases, `-word` and `or`. For plain queries it is OR-ed with a query built in text.ts in which every word may carry one diacritic in any position (malaga finds Málaga, елка finds Ёлка, sàlon finds Salón) and the last word is a prefix (search as you type). The indexes use the `simple` configuration without unaccent, so accent-insensitivity lives in this expansion; a word that needs two added diacritics is found only through the trigram match.
- Typos: `q <% title/name` (pg_trgm word similarity, threshold 0.45 set with `set_config(..., true)` inside the query's transaction) on event titles, profile names and venue names. Posts have no trigram index; a fuzzy title pass runs only when the full-text query found no posts.
- Score: 1 + ts_rank for a full-text hit, plus the word similarity of the query to the title or name, plus 1 for an exact title, name or handle. Events with a date still ahead always come before past ones.
- The tsvector expressions in search.ts repeat the index definitions of migration 202610010008_gaps exactly (`event_search_idx`, `profile_search_idx`, `post_search_idx`); changing either side alone turns the search into a sequential scan. tests/search.test.ts checks the plans with EXPLAIN.

Known limits: venue addresses have no full-text index (the venue query reads the whole table; fine for thousands of venues) and Post.title has no trigram index. A later migration could add `CREATE INDEX venue_search_idx ON "Venue" USING GIN (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(address, '')))` and `CREATE INDEX post_title_trgm_idx ON "Post" USING GIN (title gin_trgm_ops)`; the SQL already uses these exact expressions.

`<SearchBox/>` (components/search/search-box.tsx) is the header field: a combobox with debounced suggestions (three per type), arrow-key navigation, and a plain GET form to /[locale]/search that works without JavaScript.
