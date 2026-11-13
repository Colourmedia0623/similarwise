-- Designs started from the composer, waiting for Canva's return button.
CREATE TABLE "CanvaReturn" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "imageIds" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CanvaReturn_shop_createdAt_idx" ON "CanvaReturn"("shop", "createdAt");
