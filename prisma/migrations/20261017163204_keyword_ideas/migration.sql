-- CreateTable
CREATE TABLE "KeywordIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER,
    "productId" TEXT,
    "pageKind" TEXT NOT NULL,
    "pageName" TEXT NOT NULL,
    "seoTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "KeywordIdea_shop_idx" ON "KeywordIdea"("shop");
