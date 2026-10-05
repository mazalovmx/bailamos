-- Photo and short note shown when an event is opened on the map.
ALTER TABLE "Event" ADD COLUMN "mapImageKey" TEXT, ADD COLUMN "mapNote" TEXT;
