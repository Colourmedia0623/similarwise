-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "remoteId" TEXT,
    "url" TEXT,
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
    "calendarPublish" BOOLEAN NOT NULL DEFAULT true,
    "aiCheckedAt" DATETIME,
    "aiRunningAt" DATETIME,
    "aiError" TEXT,
    "aiBrand" TEXT,
    "socialAuto" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_ShopSettings" ("aiBrand", "aiCheckedAt", "aiError", "aiRunningAt", "alertEmail", "alertTopics", "alertsOn", "alertsSentAt", "calendarPublish", "digestOn", "digestSentAt", "domain", "market", "ownAdChannels", "ownApps", "ownOrganicTraffic", "ownPaidCostCents", "ownPaidTraffic", "ownTechAt", "ownTechDomain", "ownTechError", "ownTheme", "ownTrafficAt", "ownTrafficDomain", "ownTrafficMarket", "shop", "similarAt", "similarError", "similarKey") SELECT "aiBrand", "aiCheckedAt", "aiError", "aiRunningAt", "alertEmail", "alertTopics", "alertsOn", "alertsSentAt", "calendarPublish", "digestOn", "digestSentAt", "domain", "market", "ownAdChannels", "ownApps", "ownOrganicTraffic", "ownPaidCostCents", "ownPaidTraffic", "ownTechAt", "ownTechDomain", "ownTechError", "ownTheme", "ownTrafficAt", "ownTrafficDomain", "ownTrafficMarket", "shop", "similarAt", "similarError", "similarKey" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_shop_network_accountId_key" ON "SocialAccount"("shop", "network", "accountId");

-- CreateIndex
CREATE INDEX "SocialPost_shop_articleId_idx" ON "SocialPost"("shop", "articleId");
