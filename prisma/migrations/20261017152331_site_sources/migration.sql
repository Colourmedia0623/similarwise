-- CreateTable
CREATE TABLE "SiteSources" (
    "domain" TEXT NOT NULL PRIMARY KEY,
    "visits" INTEGER,
    "sources" TEXT NOT NULL DEFAULT '{}',
    "countries" TEXT NOT NULL DEFAULT '[]',
    "fetchedAt" DATETIME NOT NULL,
    "error" TEXT
);
