ALTER TYPE "UserRole" ADD VALUE 'OWNER';
ALTER TYPE "UserRole" ADD VALUE 'SCHOOL_ADMIN';
CREATE TABLE "SchoolAdmin" (
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "schoolProfileId" TEXT NOT NULL REFERENCES "Profile"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "schoolProfileId")
);
CREATE INDEX "SchoolAdmin_schoolProfileId_idx" ON "SchoolAdmin"("schoolProfileId");
ALTER TABLE "Event" ADD COLUMN "schoolProfileId" TEXT REFERENCES "Profile"("id") ON DELETE SET NULL;
ALTER TABLE "Post" ADD COLUMN "schoolProfileId" TEXT REFERENCES "Profile"("id") ON DELETE SET NULL;
ALTER TABLE "Venue" ADD COLUMN "schoolProfileId" TEXT REFERENCES "Profile"("id") ON DELETE SET NULL;
ALTER TABLE "Conversation" ADD COLUMN "schoolProfileId" TEXT REFERENCES "Profile"("id") ON DELETE SET NULL;
CREATE INDEX "Event_schoolProfileId_idx" ON "Event"("schoolProfileId");
CREATE INDEX "Post_schoolProfileId_idx" ON "Post"("schoolProfileId");
CREATE INDEX "Venue_schoolProfileId_idx" ON "Venue"("schoolProfileId");
CREATE INDEX "Conversation_schoolProfileId_idx" ON "Conversation"("schoolProfileId");
