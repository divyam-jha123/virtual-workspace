-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('pending', 'chosen', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "Selection" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "candidateIds" TEXT[],
    "chosenId" TEXT,
    "status" "SelectionStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Selection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Selection_token_key" ON "Selection"("token");

-- CreateIndex
CREATE INDEX "Selection_status_expiresAt_idx" ON "Selection"("status", "expiresAt");
