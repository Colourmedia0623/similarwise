-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ShopPlan" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "tier" TEXT,
    "competitors" INTEGER,
    "rankKeywords" INTEGER,
    "listenKeywords" INTEGER,
    "aiPrompts" INTEGER,
    "updatedAt" DATETIME NOT NULL
);

