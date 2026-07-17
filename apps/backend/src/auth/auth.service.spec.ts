import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AuthService, JwtPayload } from './auth.service';

/** Stand in for Google's verifier so no test ever hits the network. */
const verifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
  })),
}));

const GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

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
      googleId: null,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  beforeEach(() => verifyIdToken.mockReset());

  function makeService() {
    const users = { findByEmail: jest.fn(), upsertGoogleUser: jest.fn() };
    const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    const config = { get: jest.fn().mockReturnValue(GOOGLE_CLIENT_ID) };
    const service = new AuthService(
      users as unknown as UsersService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
    return { service, users, jwt };
  }

  /** Shape a Google ticket the way `verifyIdToken` returns one. */
  function googleTicket(payload: Record<string, unknown> | undefined) {
    return { getPayload: () => payload };
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

    it('rejects a Google account, which has no password to check', async () => {
      const { service, users } = makeService();
      users.findByEmail.mockResolvedValue({ ...user, passwordHash: null });

      await expect(service.login(user.email, password)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('loginWithGoogle', () => {
    const profile = {
      sub: 'google_123',
      email: 'alice@example.com',
      email_verified: true,
      name: 'Alice',
      picture: 'https://example.com/alice.jpg',
    };

    it('verifies the token against our client id', async () => {
      const { service, users } = makeService();
      verifyIdToken.mockResolvedValue(googleTicket(profile));
      users.upsertGoogleUser.mockResolvedValue(user);

      await service.loginWithGoogle('google.id.token');

      expect(verifyIdToken).toHaveBeenCalledWith({
        idToken: 'google.id.token',
        audience: GOOGLE_CLIENT_ID,
      });
    });

    it('upserts the profile and signs the same JWT shape as login()', async () => {
      const { service, users, jwt } = makeService();
      verifyIdToken.mockResolvedValue(googleTicket(profile));
      users.upsertGoogleUser.mockResolvedValue(user);

      const result = await service.loginWithGoogle('google.id.token');

      expect(users.upsertGoogleUser).toHaveBeenCalledWith({
        email: profile.email,
        displayName: profile.name,
        googleId: profile.sub,
        avatarUrl: profile.picture,
      });
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        name: user.displayName,
      } satisfies JwtPayload);
      expect(result).toEqual({ accessToken: 'signed.jwt.token' });
    });

    it('falls back to the email local-part when Google sends no name', async () => {
      const { service, users } = makeService();
      verifyIdToken.mockResolvedValue(googleTicket({ ...profile, name: undefined }));
      users.upsertGoogleUser.mockResolvedValue(user);

      await service.loginWithGoogle('google.id.token');

      expect(users.upsertGoogleUser).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'alice' }),
      );
    });

    it('throws 401 when the email is unverified, without touching the db', async () => {
      const { service, users } = makeService();
      verifyIdToken.mockResolvedValue(
        googleTicket({ ...profile, email_verified: false }),
      );

      await expect(
        service.loginWithGoogle('google.id.token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.upsertGoogleUser).not.toHaveBeenCalled();
    });

    it('throws 401 when the token does not verify', async () => {
      const { service, users } = makeService();
      verifyIdToken.mockRejectedValue(new Error('Invalid token signature'));

      await expect(service.loginWithGoogle('forged')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(users.upsertGoogleUser).not.toHaveBeenCalled();
    });

    it('throws 401 when the ticket carries no payload', async () => {
      const { service } = makeService();
      verifyIdToken.mockResolvedValue(googleTicket(undefined));

      await expect(service.loginWithGoogle('empty')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
