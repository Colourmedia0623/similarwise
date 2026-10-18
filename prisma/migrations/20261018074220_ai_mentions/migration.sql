-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "aiBrand" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "aiCheckedAt" DATETIME;
ALTER TABLE "ShopSettings" ADD COLUMN "aiError" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "aiRunningAt" DATETIME;

-- CreateTable
CREATE TABLE "AiPrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "ranAt" DATETIME NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "brands" TEXT NOT NULL DEFAULT '[]',
    "sources" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT
);

-- CreateIndex
CREATE INDEX "AiPrompt_shop_idx" ON "AiPrompt"("shop");

-- CreateIndex
CREATE INDEX "AiAnswer_shop_ranAt_idx" ON "AiAnswer"("shop", "ranAt");

-- CreateIndex
CREATE INDEX "AiAnswer_promptId_idx" ON "AiAnswer"("promptId");
