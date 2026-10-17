-- CreateTable
CREATE TABLE "BlogArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "metaTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'written',
    "shopifyId" TEXT,
    "url" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

-- CreateIndex
CREATE INDEX "BlogArticle_shop_idx" ON "BlogArticle"("shop");
