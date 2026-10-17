-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN "linksAt" DATETIME;
ALTER TABLE "Competitor" ADD COLUMN "linksDomain" TEXT;
ALTER TABLE "Competitor" ADD COLUMN "linksError" TEXT;

-- CreateTable
CREATE TABLE "CompetitorLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "rank" INTEGER,
    "backlinks" INTEGER,
    "firstSeen" DATETIME,
    CONSTRAINT "CompetitorLink_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CompetitorLink_competitorId_idx" ON "CompetitorLink"("competitorId");
