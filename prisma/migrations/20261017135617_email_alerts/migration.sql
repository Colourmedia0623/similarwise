-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "market" TEXT NOT NULL DEFAULT 'US',
    "domain" TEXT,
    "alertEmail" TEXT,
    "alertsOn" BOOLEAN NOT NULL DEFAULT true,
    "alertTopics" TEXT NOT NULL DEFAULT '["prices","products","ads","traffic"]',
    "digestOn" BOOLEAN NOT NULL DEFAULT true,
    "alertsSentAt" DATETIME,
    "digestSentAt" DATETIME
);
INSERT INTO "new_ShopSettings" ("domain", "market", "shop") SELECT "domain", "market", "shop" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
