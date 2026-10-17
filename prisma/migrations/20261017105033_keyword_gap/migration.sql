-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN "gapAt" DATETIME;
ALTER TABLE "Competitor" ADD COLUMN "gapDomain" TEXT;
ALTER TABLE "Competitor" ADD COLUMN "gapError" TEXT;
ALTER TABLE "Competitor" ADD COLUMN "gapMarket" TEXT;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "domain" TEXT;

-- CreateTable
CREATE TABLE "KeywordGap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER,
    "cpcCents" INTEGER,
    "theirPosition" INTEGER,
    "theirTraffic" INTEGER,
    "theirUrl" TEXT,
    "yourPosition" INTEGER,
    CONSTRAINT "KeywordGap_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "KeywordGap_competitorId_idx" ON "KeywordGap"("competitorId");
