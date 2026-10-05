ALTER TABLE "Event" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "creationKey" TEXT,
  ADD COLUMN "placeConfirmed" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Event_creationKey_key" ON "Event"("creationKey");
-- Web-created events already required a venue or pin. Legacy school-admin drafts did not.
UPDATE "Event" SET "placeConfirmed" = true WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL
  AND ("slug" NOT LIKE 'school-%' OR "venueId" IS NOT NULL);
-- Recover unambiguous school ownership without replacing personal memberships.
UPDATE "Event" e SET "schoolProfileId" = m."profileId" FROM "EventMembership" m
  JOIN "Profile" p ON p.id = m."profileId" AND p.type = 'SCHOOL'
  WHERE m."eventId" = e.id AND m.role = 'OWNER' AND e."schoolProfileId" IS NULL;
ALTER TABLE "EventOccurrence" ADD COLUMN "slotStartsAt" TIMESTAMPTZ(3);
ALTER TABLE "EventOccurrence" ADD COLUMN "previousStarts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "EventOccurrence" SET "slotStartsAt" = COALESCE("originalStartsAt", "startsAt");
-- A series shift may temporarily occupy another slot while preserving both row IDs.
DROP INDEX "EventOccurrence_eventId_startsAt_key";
ALTER TABLE "EventOccurrence" ADD CONSTRAINT "EventOccurrence_eventId_startsAt_key"
  UNIQUE ("eventId", "startsAt") DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "EventBookmark" (
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "eventId" TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "eventId")
);
CREATE TABLE "EventDelivery" (
  id TEXT PRIMARY KEY, "dedupeKey" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  type TEXT NOT NULL, data JSONB NOT NULL, url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  "retryAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailSentAt" TIMESTAMPTZ(3), "channelsSentAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  "lastError" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EventDelivery_completedAt_retryAt_idx" ON "EventDelivery"("completedAt", "retryAt");
