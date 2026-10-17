-- CreateTable
CREATE TABLE "ShopProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "productType" TEXT,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProductMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopProductId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "competitorProductId" TEXT,
    "score" REAL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProductMatch_shopProductId_fkey" FOREIGN KEY ("shopProductId") REFERENCES "ShopProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductMatch_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductMatch_competitorProductId_fkey" FOREIGN KEY ("competitorProductId") REFERENCES "CompetitorProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ShopProduct_shop_idx" ON "ShopProduct"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopProduct_shop_productId_key" ON "ShopProduct"("shop", "productId");

-- CreateIndex
CREATE INDEX "ProductMatch_competitorId_idx" ON "ProductMatch"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMatch_shopProductId_competitorId_key" ON "ProductMatch"("shopProductId", "competitorId");
