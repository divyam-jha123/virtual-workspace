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
    createdAt: now,
    updatedAt: now,
  };

  function makeService() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
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
});
