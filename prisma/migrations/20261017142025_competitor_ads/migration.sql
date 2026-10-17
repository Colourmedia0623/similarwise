-- CreateTable
CREATE TABLE "CompetitorAd" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "linkUrl" TEXT,
    "adUrl" TEXT,
    "cta" TEXT,
    "placements" TEXT NOT NULL DEFAULT '[]',
    "format" TEXT,
    "startedAt" DATETIME,
    "lastShownAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetitorAd_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Competitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isShopify" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT,
    "apps" TEXT NOT NULL DEFAULT '[]',
    "adChannels" TEXT NOT NULL DEFAULT '[]',
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "avgPriceCents" INTEGER,
    "currency" TEXT,
    "lastCheckedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organicTraffic" INTEGER,
    "organicKeywords" INTEGER,
    "paidTraffic" INTEGER,
    "paidKeywords" INTEGER,
    "paidCostCents" INTEGER,
    "trafficMarket" TEXT,
    "trafficAt" DATETIME,
    "trafficError" TEXT,
    "gapAt" DATETIME,
    "gapDomain" TEXT,
    "gapMarket" TEXT,
    "gapError" TEXT,
    "metaPageId" TEXT,
    "metaPageName" TEXT,
    "metaCandidates" TEXT NOT NULL DEFAULT '[]',
    "tiktokAdvertiser" TEXT,
    "tiktokCandidates" TEXT NOT NULL DEFAULT '[]',
    "adsAt" DATETIME,
    "adsMarket" TEXT,
    "adsError" TEXT
);
INSERT INTO "new_Competitor" ("adChannels", "apps", "avgPriceCents", "createdAt", "currency", "gapAt", "gapDomain", "gapError", "gapMarket", "id", "isShopify", "lastCheckedAt", "lastError", "name", "organicKeywords", "organicTraffic", "paidCostCents", "paidKeywords", "paidTraffic", "productCount", "shop", "theme", "trafficAt", "trafficError", "trafficMarket", "url") SELECT "adChannels", "apps", "avgPriceCents", "createdAt", "currency", "gapAt", "gapDomain", "gapError", "gapMarket", "id", "isShopify", "lastCheckedAt", "lastError", "name", "organicKeywords", "organicTraffic", "paidCostCents", "paidKeywords", "paidTraffic", "productCount", "shop", "theme", "trafficAt", "trafficError", "trafficMarket", "url" FROM "Competitor";
DROP TABLE "Competitor";
ALTER TABLE "new_Competitor" RENAME TO "Competitor";
CREATE INDEX "Competitor_shop_idx" ON "Competitor"("shop");
CREATE UNIQUE INDEX "Competitor_shop_url_key" ON "Competitor"("shop", "url");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CompetitorAd_competitorId_active_idx" ON "CompetitorAd"("competitorId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorAd_competitorId_platform_adId_key" ON "CompetitorAd"("competitorId", "platform", "adId");
