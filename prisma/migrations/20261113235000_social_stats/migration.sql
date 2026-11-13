-- How each sent post is doing: likes, comments, shares, reach and so on.
ALTER TABLE "SocialPost" ADD COLUMN "stats" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "statsAt" DATETIME;
