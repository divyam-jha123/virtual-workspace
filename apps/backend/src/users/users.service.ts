import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Input for creating a user. Password hashing is the caller's concern. */
export interface CreateUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

/** A verified Google profile, as resolved from an ID token. */
export interface GoogleUserInput {
  email: string;
  displayName: string;
  googleId: string;
  avatarUrl?: string;
}

/** An address proven by a one-time code. No password, no Google profile. */
export interface EmailCodeUserInput {
  email: string;
  /** Only used when creating; an existing account keeps the name it has. */
  displayName: string;
}

/**
 * Persistence accessors for user accounts. Kept intentionally thin — no HTTP
 * surface here. JWT auth (#24) and presence metadata (#26) build on top of this.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({ data: input });
  }

  /**
   * Find-or-create the account behind a verified Google profile. Keyed on email
   * rather than googleId so a user who already exists (e.g. a seeded password
   * account) links to their existing row instead of colliding on the unique
   * email. The display name refreshes from Google on every sign-in — until the
   * onboarding flow lands, that profile is the only name we have.
   */
  upsertGoogleUser(input: GoogleUserInput): Promise<User> {
    const { email, displayName, googleId, avatarUrl } = input;
    // Google only hands us a profile once it has asserted email_verified (the
    // caller checks), so arriving here is itself proof of the address.
    const emailVerifiedAt = new Date();
    return this.prisma.user.upsert({
      where: { email },
      update: { displayName, googleId, avatarUrl, emailVerifiedAt },
      create: { email, displayName, googleId, avatarUrl, emailVerifiedAt },
    });
  }

  /**
   * Find-or-create the account behind a verified one-time login code, marking
   * the address verified — reading the code out of the inbox proves control of
   * it, which is the whole point of the flow.
   *
   * Unlike the Google path this never overwrites `displayName`: the local part
   * of the address is only a placeholder, so it must not clobber a real name an
   * existing account already has.
   */
  upsertEmailCodeUser(input: EmailCodeUserInput): Promise<User> {
    const { email, displayName } = input;
    const emailVerifiedAt = new Date();
    return this.prisma.user.upsert({
      where: { email },
      update: { emailVerifiedAt },
      create: { email, displayName, emailVerifiedAt },
    });
  }
}
