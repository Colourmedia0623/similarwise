-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "auditRunningAt" DATETIME;

-- CreateTable
CREATE TABLE "SiteAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domain" TEXT NOT NULL,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "issues" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT
);

-- CreateIndex
CREATE INDEX "SiteAudit_shop_ranAt_idx" ON "SiteAudit"("shop", "ranAt");
