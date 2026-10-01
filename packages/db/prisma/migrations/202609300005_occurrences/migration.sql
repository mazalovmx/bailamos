-- Preserve existing events in the session-based directory.
INSERT INTO "EventOccurrence" (id, "eventId", "startsAt", "endsAt", cancelled)
SELECT id || ':initial', id, "startsAt", "endsAt", false FROM "Event"
ON CONFLICT ("eventId", "startsAt") DO NOTHING;
