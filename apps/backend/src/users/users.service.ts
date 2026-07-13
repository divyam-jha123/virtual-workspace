import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Input for creating a user. Password hashing is the caller's concern. */
export interface CreateUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
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
}
