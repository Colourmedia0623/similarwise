-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "similarAt" DATETIME;
ALTER TABLE "ShopSettings" ADD COLUMN "similarError" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "similarKey" TEXT;

-- CreateTable
CREATE TABLE "SimilarSite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sharedKeywords" INTEGER NOT NULL,
    "traffic" INTEGER,
    "similarTo" TEXT NOT NULL DEFAULT '[]'
);

-- CreateIndex
CREATE UNIQUE INDEX "SimilarSite_shop_domain_key" ON "SimilarSite"("shop", "domain");
