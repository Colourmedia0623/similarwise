-- CreateTable
CREATE TABLE "GoogleConnection" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "gaProperty" TEXT,
    "gaName" TEXT,
    "adsCustomer" TEXT,
    "adsLogin" TEXT,
    "adsName" TEXT,
    "report" JSONB,
    "checkedAt" DATETIME,
    "runningAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
