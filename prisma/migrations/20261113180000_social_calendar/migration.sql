-- CreateTable
CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "captions" TEXT NOT NULL DEFAULT '{}',
    "accountIds" TEXT NOT NULL DEFAULT '[]',
    "tiktok" TEXT,
    "imageId" TEXT,
    "link" TEXT,
    "campaignId" TEXT,
    "status" TEXT NOT NULL,
    "scheduledAt" DATETIME,
    "sentAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SocialImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SocialCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "startDay" TEXT,
    "endDay" TEXT,
    "note" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SocialPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "articleId" TEXT,
    "scheduleId" TEXT,
    "accountId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "remoteId" TEXT,
    "url" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_SocialPost" ("accountId", "articleId", "caption", "createdAt", "error", "id", "network", "remoteId", "shop", "status", "url") SELECT "accountId", "articleId", "caption", "createdAt", "error", "id", "network", "remoteId", "shop", "status", "url" FROM "SocialPost";
DROP TABLE "SocialPost";
ALTER TABLE "new_SocialPost" RENAME TO "SocialPost";
CREATE INDEX "SocialPost_shop_articleId_idx" ON "SocialPost"("shop", "articleId");
CREATE INDEX "SocialPost_shop_scheduleId_idx" ON "SocialPost"("shop", "scheduleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ScheduledPost_shop_scheduledAt_idx" ON "ScheduledPost"("shop", "scheduledAt");

-- CreateIndex
CREATE INDEX "ScheduledPost_status_scheduledAt_idx" ON "ScheduledPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SocialImage_shop_idx" ON "SocialImage"("shop");

-- CreateIndex
CREATE INDEX "SocialCampaign_shop_idx" ON "SocialCampaign"("shop");

