-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('CLASS', 'WORKSHOP', 'MASTERCLASS', 'INTENSIVE', 'PRACTICE', 'SOCIAL', 'FESTIVAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DanceFormat" AS ENUM ('SOLO', 'PARTNER', 'MIXED', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "EventLevel" AS ENUM ('OPEN', 'NEWCOMER', 'BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'PRO', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "Intensity" AS ENUM ('RELAXED', 'MODERATE', 'ENERGETIC', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "MusicTempo" AS ENUM ('SLOW', 'MEDIUM', 'FAST', 'VARIED', 'UNSPECIFIED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "format" "DanceFormat" NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN     "intensity" "Intensity" NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN     "kind" "EventKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "level" "EventLevel" NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN     "partnerRequired" BOOLEAN,
ADD COLUMN     "prerequisites" TEXT,
ADD COLUMN     "tempo" "MusicTempo" NOT NULL DEFAULT 'UNSPECIFIED';

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTag" (
    "eventId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "EventTag_pkey" PRIMARY KEY ("eventId","tagId")
);

-- CreateIndex
CREATE INDEX "EventTag_tagId_idx" ON "EventTag"("tagId");

-- CreateIndex
CREATE INDEX "Event_kind_format_level_idx" ON "Event"("kind", "format", "level");

-- AddForeignKey
ALTER TABLE "EventTag" ADD CONSTRAINT "EventTag_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTag" ADD CONSTRAINT "EventTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
