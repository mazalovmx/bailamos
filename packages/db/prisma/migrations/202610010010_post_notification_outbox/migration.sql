ALTER TABLE "Notification" ADD COLUMN "dedupeKey" text;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE TABLE "PostNotificationOutbox" (
  "postId" text PRIMARY KEY,
  "excludeUserId" text,
  "lastFollowId" text,
  "notified" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" timestamptz(3),
  CONSTRAINT "PostNotificationOutbox_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PostNotificationOutbox_completedAt_createdAt_idx" ON "PostNotificationOutbox"("completedAt", "createdAt");
