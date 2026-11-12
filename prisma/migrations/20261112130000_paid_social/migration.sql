-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME,
    "monthlyLimit" REAL,
    "limitPause" BOOLEAN NOT NULL DEFAULT false,
    "limitNotified" TEXT,
    "monthSpend" REAL,
    "monthSpendAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AdChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "by" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_shop_network_accountId_key" ON "AdAccount"("shop", "network", "accountId");

-- CreateIndex
CREATE INDEX "AdChange_shop_createdAt_idx" ON "AdChange"("shop", "createdAt");
