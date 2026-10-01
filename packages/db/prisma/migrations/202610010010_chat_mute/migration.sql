-- Per-conversation mute.
ALTER TABLE "ConversationMember" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;
