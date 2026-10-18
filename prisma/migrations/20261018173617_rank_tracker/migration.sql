-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "ranksCheckedAt" DATETIME;
ALTER TABLE "ShopSettings" ADD COLUMN "ranksError" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "ranksRunningAt" DATETIME;

-- CreateTable
CREATE TABLE "TrackedKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "KeywordRank" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "competitors" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedKeyword_shop_keyword_key" ON "TrackedKeyword"("shop", "keyword");

-- CreateIndex
CREATE INDEX "KeywordRank_shop_checkedAt_idx" ON "KeywordRank"("shop", "checkedAt");

-- CreateIndex
CREATE INDEX "KeywordRank_keywordId_checkedAt_idx" ON "KeywordRank"("keywordId", "checkedAt");
