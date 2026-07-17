import { PrismaService } from '../../prisma/prisma.service';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  let prisma: {
    roomMembership: {
      upsert: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let service: PresenceService;

  beforeEach(() => {
    prisma = {
      roomMembership: {
        upsert: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new PresenceService(prisma as unknown as PrismaService);
  });

  it('upserts an open membership row when a participant joins', async () => {
    await service.participantJoined({
      roomName: 'spike-room',
      identity: 'user-1',
      displayName: 'Ada',
    });

    expect(prisma.roomMembership.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.roomMembership.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      roomName_identity: { roomName: 'spike-room', identity: 'user-1' },
    });
    // A (re)join must clear any prior leftAt so the member reads as present.
    expect(arg.create.leftAt).toBeNull();
    expect(arg.update.leftAt).toBeNull();
    expect(arg.create.displayName).toBe('Ada');
  });

  it('records leftAt/lastSeenAt when a participant leaves', async () => {
    await service.participantLeft({
      roomName: 'spike-room',
      identity: 'user-1',
    });

    const arg = prisma.roomMembership.upsert.mock.calls[0][0];
    expect(arg.update.leftAt).toBeInstanceOf(Date);
    expect(arg.update.lastSeenAt).toBeInstanceOf(Date);
    // Falls back to a closed row if the join was never seen.
    expect(arg.create.leftAt).toBeInstanceOf(Date);
  });

  it('closes every still-present member when a room finishes', async () => {
    await service.roomFinished('spike-room');

    expect(prisma.roomMembership.updateMany).toHaveBeenCalledWith({
      where: { roomName: 'spike-room', leftAt: null },
      data: { leftAt: expect.any(Date), lastSeenAt: expect.any(Date) },
    });
  });

  it('lists only currently-connected members for a room', async () => {
    await service.activeMembers('spike-room');

    expect(prisma.roomMembership.findMany).toHaveBeenCalledWith({
      where: { roomName: 'spike-room', leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });
  });
});
