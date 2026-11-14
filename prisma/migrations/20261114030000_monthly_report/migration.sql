-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "reportOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopSettings" ADD COLUMN "reportSentAt" DATETIME;
