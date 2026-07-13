import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AuthService, JwtPayload } from './auth.service';

describe('AuthService', () => {
  const password = 'password123';
  let passwordHash: string;
  let user: User;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 10);
    user = {
      id: 'user_1',
      email: 'alice@example.com',
      displayName: 'Alice',
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  function makeService() {
    const users = { findByEmail: jest.fn() };
    const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    const service = new AuthService(
      users as unknown as UsersService,
      jwt as unknown as JwtService,
    );
    return { service, users, jwt };
  }

  describe('validateUser', () => {
    it('returns the user when the password matches', async () => {
      const { service, users } = makeService();
      users.findByEmail.mockResolvedValue(user);

      await expect(service.validateUser(user.email, password)).resolves.toBe(
        user,
      );
    });

    it('returns null when the password is wrong', async () => {
      const { service, users } = makeService();
      users.findByEmail.mockResolvedValue(user);

      await expect(
        service.validateUser(user.email, 'wrong'),
      ).resolves.toBeNull();
    });

    it('returns null when the user does not exist', async () => {
      const { service, users } = makeService();
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.validateUser('nobody@example.com', password),
      ).resolves.toBeNull();
    });
  });

  describe('login', () => {
    it('signs a JWT with sub/email/name and returns the token', async () => {
      const { service, users, jwt } = makeService();
      users.findByEmail.mockResolvedValue(user);

      const result = await service.login(user.email, password);

      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        name: user.displayName,
      } satisfies JwtPayload);
      expect(result).toEqual({ accessToken: 'signed.jwt.token' });
    });

    it('throws 401 on bad credentials', async () => {
      const { service, users, jwt } = makeService();
      users.findByEmail.mockResolvedValue(user);

      await expect(service.login(user.email, 'wrong')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });
});
