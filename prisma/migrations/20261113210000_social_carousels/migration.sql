-- A calendar post can hold several pictures, sent as a carousel.
ALTER TABLE "ScheduledPost" ADD COLUMN "imageIds" TEXT NOT NULL DEFAULT '[]';
