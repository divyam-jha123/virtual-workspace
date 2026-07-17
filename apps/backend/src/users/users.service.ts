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
    return this.prisma.user.upsert({
      where: { email },
      update: { displayName, googleId, avatarUrl },
      create: { email, displayName, googleId, avatarUrl },
    });
  }
}
