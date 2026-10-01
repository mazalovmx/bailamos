-- Per-date answers for recurring events, moved single dates, chat attachments/edits and localized city names.
ALTER TABLE "City" ADD COLUMN "names" JSONB;
ALTER TABLE "EventOccurrence" ADD COLUMN "originalStartsAt" TIMESTAMPTZ(3);
ALTER TABLE "Message" ADD COLUMN "attachmentKey" TEXT,
  ADD COLUMN "editedAt" TIMESTAMPTZ(3),
  ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
CREATE TABLE "OccurrenceRsvp" (
  "occurrenceId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "status" "RsvpStatus" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OccurrenceRsvp_pkey" PRIMARY KEY ("occurrenceId","profileId")
);
CREATE INDEX "OccurrenceRsvp_profileId_idx" ON "OccurrenceRsvp"("profileId");
ALTER TABLE "OccurrenceRsvp" ADD CONSTRAINT "OccurrenceRsvp_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "EventOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OccurrenceRsvp" ADD CONSTRAINT "OccurrenceRsvp_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Full-text and fuzzy search without a separate search service (the specification allows PostgreSQL instead of Meilisearch).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX event_search_idx ON "Event" USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')));
CREATE INDEX event_title_trgm_idx ON "Event" USING GIN (title gin_trgm_ops);
CREATE INDEX profile_search_idx ON "Profile" USING GIN (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(handle, '') || ' ' || coalesce(bio, '')));
CREATE INDEX profile_name_trgm_idx ON "Profile" USING GIN (name gin_trgm_ops);
CREATE INDEX post_search_idx ON "Post" USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, '')));
CREATE INDEX venue_name_trgm_idx ON "Venue" USING GIN (name gin_trgm_ops);
