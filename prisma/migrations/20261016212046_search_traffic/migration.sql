-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN "organicKeywords" INTEGER;
ALTER TABLE "Competitor" ADD COLUMN "organicTraffic" INTEGER;
ALTER TABLE "Competitor" ADD COLUMN "paidCostCents" INTEGER;
ALTER TABLE "Competitor" ADD COLUMN "paidKeywords" INTEGER;
ALTER TABLE "Competitor" ADD COLUMN "paidTraffic" INTEGER;
ALTER TABLE "Competitor" ADD COLUMN "trafficAt" DATETIME;
ALTER TABLE "Competitor" ADD COLUMN "trafficError" TEXT;
ALTER TABLE "Competitor" ADD COLUMN "trafficMarket" TEXT;

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "market" TEXT NOT NULL DEFAULT 'US'
);

-- CreateTable
CREATE TABLE "TrafficSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorId" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "market" TEXT NOT NULL,
    "organicTraffic" INTEGER NOT NULL,
    "organicKeywords" INTEGER NOT NULL,
    "paidTraffic" INTEGER NOT NULL,
    "paidKeywords" INTEGER NOT NULL,
    "paidCostCents" INTEGER NOT NULL,
    CONSTRAINT "TrafficSnapshot_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetitorKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER,
    "searchVolume" INTEGER,
    "traffic" INTEGER,
    "url" TEXT,
    CONSTRAINT "CompetitorKeyword_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrafficSnapshot_competitorId_takenAt_idx" ON "TrafficSnapshot"("competitorId", "takenAt");

-- CreateIndex
CREATE INDEX "CompetitorKeyword_competitorId_type_idx" ON "CompetitorKeyword"("competitorId", "type");
