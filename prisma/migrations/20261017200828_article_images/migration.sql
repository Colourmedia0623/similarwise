-- AlterTable
ALTER TABLE "BlogArticle" ADD COLUMN "imageAlt" TEXT;
ALTER TABLE "BlogArticle" ADD COLUMN "imageError" TEXT;

-- CreateTable
CREATE TABLE "ArticleImage" (
    "articleId" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'image/jpeg',
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ArticleImage_shop_idx" ON "ArticleImage"("shop");
