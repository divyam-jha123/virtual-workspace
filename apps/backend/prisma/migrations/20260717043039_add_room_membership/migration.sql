-- CreateTable
CREATE TABLE "RoomMembership" (
    "id" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "displayName" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomMembership_roomName_leftAt_idx" ON "RoomMembership"("roomName", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMembership_roomName_identity_key" ON "RoomMembership"("roomName", "identity");
