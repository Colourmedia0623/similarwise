-- AlterTable
ALTER TABLE "CompetitorProduct" ADD COLUMN "available" BOOLEAN;
ALTER TABLE "CompetitorProduct" ADD COLUMN "soldOutAt" DATETIME;

-- AlterTable
ALTER TABLE "CompetitorSnapshot" ADD COLUMN "soldOutCount" INTEGER NOT NULL DEFAULT 0;
