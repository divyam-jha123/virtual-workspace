import { Injectable, Logger } from '@nestjs/common';
import { RoomMembership } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** A participant identity in a room, as reported by LiveKit webhooks. */
export interface RoomParticipant {
  roomName: string;
  identity: string;
  displayName?: string;
}

/**
 * Persists minimal presence metadata (room membership + last-seen) driven by
 * LiveKit webhooks (#26).
 *
 * This is *metadata only* — under Option B the backend never relays position or
 * any other game state; those ride LiveKit directly. Membership rows exist so
 * the presence feature can answer "who is (or was recently) in this room?"
 * without the client having to be connected.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mark a participant as present in a room. Upserts so a reconnect (or a
   * duplicated webhook delivery) re-opens the same membership row rather than
   * creating a second one, and clears any prior `leftAt`.
   */
  async participantJoined(p: RoomParticipant): Promise<void> {
    const now = new Date();
    await this.prisma.roomMembership.upsert({
      where: { roomName_identity: { roomName: p.roomName, identity: p.identity } },
      create: {
        roomName: p.roomName,
        identity: p.identity,
        displayName: p.displayName,
        joinedAt: now,
        lastSeenAt: now,
        leftAt: null,
      },
      update: {
        displayName: p.displayName,
        joinedAt: now,
        lastSeenAt: now,
        leftAt: null,
      },
    });
    this.logger.log(`participant joined: ${p.identity} -> ${p.roomName}`);
  }

  /**
   * Mark a participant as gone. Records `leftAt`/`lastSeenAt` on the existing
   * row; if we somehow never saw the join, upsert a closed row so the last-seen
   * is still captured.
   */
  async participantLeft(p: RoomParticipant): Promise<void> {
    const now = new Date();
    await this.prisma.roomMembership.upsert({
      where: { roomName_identity: { roomName: p.roomName, identity: p.identity } },
      create: {
        roomName: p.roomName,
        identity: p.identity,
        displayName: p.displayName,
        joinedAt: now,
        lastSeenAt: now,
        leftAt: now,
      },
      update: {
        leftAt: now,
        lastSeenAt: now,
      },
    });
    this.logger.log(`participant left: ${p.identity} <- ${p.roomName}`);
  }

  /**
   * Room shut down — close out anyone still marked present. Idempotent: rows
   * already closed keep their original `leftAt`.
   */
  async roomFinished(roomName: string): Promise<void> {
    const now = new Date();
    const { count } = await this.prisma.roomMembership.updateMany({
      where: { roomName, leftAt: null },
      data: { leftAt: now, lastSeenAt: now },
    });
    this.logger.log(`room finished: ${roomName} (closed ${count} membership(s))`);
  }

  /** Participants currently connected to a room (for the presence roster). */
  activeMembers(roomName: string): Promise<RoomMembership[]> {
    return this.prisma.roomMembership.findMany({
      where: { roomName, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });
  }
}
