-- CreateTable
CREATE TABLE "PlannedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER,
    "title" TEXT NOT NULL,
    "angle" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "claimedAt" DATETIME,
    "articleId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "market" TEXT NOT NULL DEFAULT 'US',
    "domain" TEXT,
    "ownOrganicTraffic" INTEGER,
    "ownPaidTraffic" INTEGER,
    "ownPaidCostCents" INTEGER,
    "ownTrafficDomain" TEXT,
    "ownTrafficMarket" TEXT,
    "ownTrafficAt" DATETIME,
    "ownTheme" TEXT,
    "ownApps" TEXT NOT NULL DEFAULT '[]',
    "ownAdChannels" TEXT NOT NULL DEFAULT '[]',
    "ownTechDomain" TEXT,
    "ownTechAt" DATETIME,
    "ownTechError" TEXT,
    "similarAt" DATETIME,
    "similarKey" TEXT,
    "similarError" TEXT,
    "alertEmail" TEXT,
    "alertsOn" BOOLEAN NOT NULL DEFAULT true,
    "alertTopics" TEXT NOT NULL DEFAULT '["prices","products","ads","traffic"]',
    "digestOn" BOOLEAN NOT NULL DEFAULT true,
    "alertsSentAt" DATETIME,
    "digestSentAt" DATETIME,
    "calendarPublish" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_ShopSettings" ("alertEmail", "alertTopics", "alertsOn", "alertsSentAt", "digestOn", "digestSentAt", "domain", "market", "ownAdChannels", "ownApps", "ownOrganicTraffic", "ownPaidCostCents", "ownPaidTraffic", "ownTechAt", "ownTechDomain", "ownTechError", "ownTheme", "ownTrafficAt", "ownTrafficDomain", "ownTrafficMarket", "shop", "similarAt", "similarError", "similarKey") SELECT "alertEmail", "alertTopics", "alertsOn", "alertsSentAt", "digestOn", "digestSentAt", "domain", "market", "ownAdChannels", "ownApps", "ownOrganicTraffic", "ownPaidCostCents", "ownPaidTraffic", "ownTechAt", "ownTechDomain", "ownTechError", "ownTheme", "ownTrafficAt", "ownTrafficDomain", "ownTrafficMarket", "shop", "similarAt", "similarError", "similarKey" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PlannedPost_shop_day_idx" ON "PlannedPost"("shop", "day");

-- CreateIndex
CREATE INDEX "PlannedPost_status_day_idx" ON "PlannedPost"("status", "day");
