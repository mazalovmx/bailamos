-- Coordinate validation and synchronization prevent scalar/geography drift.
CREATE FUNCTION sync_geo_point() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.lat IS NULL) <> (NEW.lng IS NULL) THEN
    RAISE EXCEPTION 'Latitude and longitude must both be present or both be null' USING ERRCODE = '23514';
  END IF;
  IF NEW.lat IS NOT NULL AND (NEW.lat NOT BETWEEN -90 AND 90 OR NEW.lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Coordinates out of range' USING ERRCODE = '23514';
  END IF;
  NEW.geo := CASE WHEN NEW.lat IS NULL THEN NULL
    ELSE ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER event_geo_sync BEFORE INSERT OR UPDATE ON "Event" FOR EACH ROW EXECUTE FUNCTION sync_geo_point();
CREATE TRIGGER venue_geo_sync BEFORE INSERT OR UPDATE ON "Venue" FOR EACH ROW EXECUTE FUNCTION sync_geo_point();
CREATE TRIGGER city_geo_sync BEFORE INSERT OR UPDATE ON "City" FOR EACH ROW EXECUTE FUNCTION sync_geo_point();
CREATE INDEX event_geo_idx ON "Event" USING GIST (geo);
CREATE INDEX venue_geo_idx ON "Venue" USING GIST (geo);
CREATE INDEX city_geo_idx ON "City" USING GIST (geo);
ALTER TABLE "Event" ADD CONSTRAINT event_time_order CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "EventOccurrence" ADD CONSTRAINT occurrence_time_order CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "MediaItem" ADD CONSTRAINT media_one_parent CHECK (num_nonnulls("postId", "eventId") = 1);
ALTER TABLE "MediaItem" ADD CONSTRAINT media_source CHECK (
  (kind = 'upload' AND "storageKey" IS NOT NULL AND "sourceUrl" IS NULL) OR
  (kind = 'instagram' AND "sourceUrl" IS NOT NULL AND "storageKey" IS NULL)
);
