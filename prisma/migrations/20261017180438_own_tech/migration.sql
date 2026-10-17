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
    "alertEmail" TEXT,
    "alertsOn" BOOLEAN NOT NULL DEFAULT true,
    "alertTopics" TEXT NOT NULL DEFAULT '["prices","products","ads","traffic"]',
    "digestOn" BOOLEAN NOT NULL DEFAULT true,
    "alertsSentAt" DATETIME,
    "digestSentAt" DATETIME
);
INSERT INTO "new_ShopSettings" ("alertEmail", "alertTopics", "alertsOn", "alertsSentAt", "digestOn", "digestSentAt", "domain", "market", "ownOrganicTraffic", "ownPaidCostCents", "ownPaidTraffic", "ownTrafficAt", "ownTrafficDomain", "ownTrafficMarket", "shop") SELECT "alertEmail", "alertTopics", "alertsOn", "alertsSentAt", "digestOn", "digestSentAt", "domain", "market", "ownOrganicTraffic", "ownPaidCostCents", "ownPaidTraffic", "ownTrafficAt", "ownTrafficDomain", "ownTrafficMarket", "shop" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
