-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WaitlistEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "store" TEXT,
    "revenue" TEXT,
    "tracking" TEXT,
    "features" TEXT,
    "price" TEXT,
    "question" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_WaitlistEntry" ("createdAt", "email", "features", "id", "price", "question", "revenue", "store", "tracking", "updatedAt") SELECT "createdAt", "email", "features", "id", "price", "question", "revenue", "store", "tracking", "updatedAt" FROM "WaitlistEntry";
DROP TABLE "WaitlistEntry";
ALTER TABLE "new_WaitlistEntry" RENAME TO "WaitlistEntry";
CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
