-- Venue address search and typo-tolerant post titles; the expressions match the queries in apps/web/src/lib/search/search.ts.
CREATE INDEX venue_search_idx ON "Venue" USING GIN (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(address, '')));
CREATE INDEX post_title_trgm_idx ON "Post" USING GIN (title gin_trgm_ops);
