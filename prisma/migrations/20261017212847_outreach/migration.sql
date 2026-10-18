-- CreateTable
CREATE TABLE "Outreach" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "siteTitle" TEXT,
    "emails" TEXT NOT NULL DEFAULT '[]',
    "to" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sentAt" DATETIME,
    "followUps" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Outreach_shop_idx" ON "Outreach"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Outreach_shop_domain_key" ON "Outreach"("shop", "domain");
