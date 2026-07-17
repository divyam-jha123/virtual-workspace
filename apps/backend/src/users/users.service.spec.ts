import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const now = new Date();
  const sampleUser: User = {
    id: 'user_1',
    email: 'alice@example.com',
    displayName: 'Alice',
    passwordHash: 'hash',
    googleId: null,
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  };

  function makeService() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const service = new UsersService(prisma as unknown as PrismaService);
    return { service, prisma };
  }

  it('looks a user up by email', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(sampleUser);

    const result = await service.findByEmail('alice@example.com');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
    expect(result).toBe(sampleUser);
  });

  it('looks a user up by id', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(sampleUser);

    const result = await service.findById('user_1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
    });
    expect(result).toBe(sampleUser);
  });

  it('returns null when a user is not found', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.findByEmail('nobody@example.com')).resolves.toBeNull();
  });

  it('creates a user with the provided fields', async () => {
    const { service, prisma } = makeService();
    const input = {
      email: 'bob@example.com',
      displayName: 'Bob',
      passwordHash: 'hash',
    };
    prisma.user.create.mockResolvedValue({ ...sampleUser, ...input });

    await service.create(input);

    expect(prisma.user.create).toHaveBeenCalledWith({ data: input });
  });

  describe('upsertGoogleUser', () => {
    const input = {
      email: 'alice@example.com',
      displayName: 'Alice',
      googleId: 'google_123',
      avatarUrl: 'https://example.com/alice.jpg',
    };

    it('upserts on email so an existing account links instead of colliding', async () => {
      const { service, prisma } = makeService();
      prisma.user.upsert.mockResolvedValue(sampleUser);

      await service.upsertGoogleUser(input);

      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { email: input.email },
        update: {
          displayName: input.displayName,
          googleId: input.googleId,
          avatarUrl: input.avatarUrl,
        },
        create: input,
      });
    });

    it('creates the account with no password hash', async () => {
      const { service, prisma } = makeService();
      prisma.user.upsert.mockResolvedValue(sampleUser);

      await service.upsertGoogleUser(input);

      const { create } = prisma.user.upsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
      };
      expect(create).not.toHaveProperty('passwordHash');
    });
  });
});
