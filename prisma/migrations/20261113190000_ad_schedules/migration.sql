-- CreateTable
CREATE TABLE "AdSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" REAL,
    "runAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AdSchedule_status_runAt_idx" ON "AdSchedule"("status", "runAt");

-- CreateIndex
CREATE INDEX "AdSchedule_shop_runAt_idx" ON "AdSchedule"("shop", "runAt");
