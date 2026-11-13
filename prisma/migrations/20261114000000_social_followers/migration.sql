-- Each social account's follower count, once a day.
CREATE TABLE "SocialFollowers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "followers" INTEGER NOT NULL
);

CREATE UNIQUE INDEX "SocialFollowers_accountId_day_key" ON "SocialFollowers"("accountId", "day");
CREATE INDEX "SocialFollowers_shop_day_idx" ON "SocialFollowers"("shop", "day");
