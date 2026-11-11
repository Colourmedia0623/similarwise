-- AlterTable
ALTER TABLE "CompetitorProduct" ADD COLUMN "variantCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CompetitorProduct" ADD COLUMN "soldOutOptions" TEXT NOT NULL DEFAULT '[]';
