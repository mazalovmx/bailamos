-- Sign-up with a seat limit and a link for participants.
ALTER TABLE "Event" ADD COLUMN "capacity" INTEGER,
  ADD COLUMN "link" TEXT,
  ADD COLUMN "linkForAttendees" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD CONSTRAINT event_capacity_positive CHECK ("capacity" IS NULL OR "capacity" > 0);
