-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "inboxError" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "inboxSyncedAt" DATETIME;

-- CreateTable
CREATE TABLE "InboxThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT NOT NULL,
    "postId" TEXT,
    "postUrl" TEXT,
    "postText" TEXT,
    "lastText" TEXT NOT NULL DEFAULT '',
    "lastAt" DATETIME NOT NULL,
    "lastFrom" TEXT NOT NULL DEFAULT 'them',
    "waitingSince" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" DATETIME,
    "assignee" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "sentiment" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "autoReplied" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "fromUs" BOOLEAN NOT NULL DEFAULT false,
    "author" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "sentBy" TEXT
);

-- CreateTable
CREATE TABLE "InboxMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skills" TEXT NOT NULL DEFAULT '[]',
    "routing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InboxRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "on" BOOLEAN NOT NULL DEFAULT true,
    "networks" TEXT NOT NULL DEFAULT '[]',
    "kinds" TEXT NOT NULL DEFAULT '[]',
    "words" TEXT NOT NULL DEFAULT '[]',
    "sentiment" TEXT,
    "addTags" TEXT NOT NULL DEFAULT '[]',
    "assignTo" TEXT,
    "reply" TEXT,
    "resolve" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "InboxThread_shop_status_lastAt_idx" ON "InboxThread"("shop", "status", "lastAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxThread_accountId_remoteId_key" ON "InboxThread"("accountId", "remoteId");

-- CreateIndex
CREATE INDEX "InboxMessage_threadId_at_idx" ON "InboxMessage"("threadId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "InboxMessage_threadId_remoteId_key" ON "InboxMessage"("threadId", "remoteId");

-- CreateIndex
CREATE INDEX "InboxMember_shop_idx" ON "InboxMember"("shop");

-- CreateIndex
CREATE INDEX "InboxRule_shop_idx" ON "InboxRule"("shop");

