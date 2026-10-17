-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "ownOrganicTraffic" INTEGER;
ALTER TABLE "ShopSettings" ADD COLUMN "ownPaidCostCents" INTEGER;
ALTER TABLE "ShopSettings" ADD COLUMN "ownPaidTraffic" INTEGER;
ALTER TABLE "ShopSettings" ADD COLUMN "ownTrafficAt" DATETIME;
ALTER TABLE "ShopSettings" ADD COLUMN "ownTrafficDomain" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "ownTrafficMarket" TEXT;
