-- Social listening: topics the shop listens for, and the mentions found.
ALTER TABLE "ShopSettings" ADD COLUMN "listenCheckedAt" DATETIME;
ALTER TABLE "ShopSettings" ADD COLUMN "listenRunningAt" DATETIME;
ALTER TABLE "ShopSettings" ADD COLUMN "listenError" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "listenInsights" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "listenInsightsAt" DATETIME;

CREATE TABLE "ListenTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "terms" TEXT NOT NULL DEFAULT '[]',
    "competitorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ListenTopic_shop_idx" ON "ListenTopic"("shop");

CREATE TABLE "ListenMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT,
    "place" TEXT,
    "title" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    "foundAt" DATETIME NOT NULL,
    "engagement" INTEGER,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "relevant" BOOLEAN NOT NULL DEFAULT true,
    "sentiment" TEXT,
    "themes" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT
);
CREATE UNIQUE INDEX "ListenMention_topicId_source_externalId_key" ON "ListenMention"("topicId", "source", "externalId");
CREATE INDEX "ListenMention_shop_foundAt_idx" ON "ListenMention"("shop", "foundAt");
CREATE INDEX "ListenMention_shop_publishedAt_idx" ON "ListenMention"("shop", "publishedAt");
