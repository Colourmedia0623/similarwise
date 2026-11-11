-- AlterTable
ALTER TABLE "CompetitorProduct" ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompetitorProduct" ADD COLUMN "soldOutAt" DATETIME;

-- AlterTable
ALTER TABLE "CompetitorSnapshot" ADD COLUMN "soldOutCount" INTEGER NOT NULL DEFAULT 0;
