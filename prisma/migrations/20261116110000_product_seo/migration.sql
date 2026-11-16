-- CreateTable
CREATE TABLE "ProductSeo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "newTitle" TEXT NOT NULL,
    "newSeoTitle" TEXT NOT NULL,
    "newSeoDescription" TEXT NOT NULL,
    "why" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductSeo_shop_productId_key" ON "ProductSeo"("shop", "productId");

