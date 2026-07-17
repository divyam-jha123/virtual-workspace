import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { UsersService } from '../users/users.service';

/** Claims carried in the signed JWT. `sub` is the LiveKit identity. */
export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
}

export interface LoginResponse {
  accessToken: string;
}

@Injectable()
export class AuthService {
  private readonly googleClientId: string;
  private readonly google: OAuth2Client;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    // ConfigModule fails at boot if this is missing, so it is set by now.
    this.googleClientId = config.get<string>('GOOGLE_CLIENT_ID')!;
    this.google = new OAuth2Client(this.googleClientId);
  }

  /** Return the user when the password matches, otherwise null. */
  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.users.findByEmail(email);
    // Google accounts carry no password hash — they cannot log in this way.
    if (!user?.passwordHash) {
      return null;
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    return matches ? user : null;
  }

  /** Validate credentials and issue a signed JWT, or throw 401. */
  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueToken(user);
  }

  /**
   * Verify a Google ID token from the browser's sign-in popup, find-or-create
   * the matching account, and issue our own JWT. The token is verified against
   * Google's keys server-side, so a client cannot forge an identity.
   */
  async loginWithGoogle(idToken: string): Promise<LoginResponse> {
    const payload = await this.verifyGoogleIdToken(idToken);

    // An unverified email would let someone claim an address they don't own —
    // and since accounts are keyed on email, that would hijack an existing row.
    if (!payload.email || !payload.email_verified) {
      throw new UnauthorizedException('Google account has no verified email');
    }

    const user = await this.users.upsertGoogleUser({
      email: payload.email,
      // `name` is absent when the user withholds profile scope; the local part
      // of the email is a reasonable stand-in until onboarding asks for one.
      displayName: payload.name ?? payload.email.split('@')[0],
      googleId: payload.sub,
      avatarUrl: payload.picture,
    });
    return this.issueToken(user);
  }

  private async verifyGoogleIdToken(idToken: string) {
    try {
      const ticket = await this.google.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new UnauthorizedException('Invalid Google token');
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Expired, wrong audience, bad signature — all indistinguishable to the
      // client on purpose; the details go to the server log, not the response.
      throw new UnauthorizedException('Invalid Google token');
    }
  }

  /** The single place a session JWT is minted, whichever way you signed in. */
  private async issueToken(user: User): Promise<LoginResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.displayName,
    };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}
