import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { Mailer, MAILER } from '../mail/mailer';
import { loginCodeEmail } from '../mail/templates/login-code';
import { PrismaService } from '../prisma/prisma.service';
import { TooManyCodeRequestsException } from './too-many-code-requests.exception';

/** How long a code stays usable. Long enough to switch to an inbox and back. */
const TTL_MINUTES = 10;
/** Guesses allowed against one issued code before it's dead. */
const MAX_ATTEMPTS = 5;
/** Sends allowed per address per window — a brake on using us to spam someone. */
const MAX_REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MINUTES = 15;
const BCRYPT_ROUNDS = 10;

/**
 * Normalise an address before it touches the database.
 *
 * `User.email` is unique, so without this `Foo@x.com` and `foo@x.com` would race
 * to create two accounts for one person — and a code sent to one wouldn't verify
 * against the other.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Issues and verifies one-time login codes.
 *
 * Every limit that matters lives here: expiry, guess cap, and send rate. All of
 * them are enforced against Postgres rather than in-process memory — the backend
 * is stateless and horizontally scaled, so a counter in a local Map would be
 * per-instance and bypassable by hitting a different one (and Redis doesn't
 * enter this project until Phase 3+; see CLAUDE.md).
 */
@Injectable()
export class EmailCodeService {
  private readonly log = new Logger(EmailCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * Generate a code for `email`, store its hash, and send it.
   *
   * Behaves identically whether or not an account exists: with passwordless
   * sign-in, signup and login are the same flow, so there's nothing to leak.
   */
  async requestCode(email: string): Promise<void> {
    const address = normaliseEmail(email);
    await this.enforceRequestRate(address);

    // A fresh code retires the old one, so a resend leaves exactly one live code
    // per address — otherwise the earlier one would linger until its own expiry.
    await this.prisma.loginCode.updateMany({
      where: { email: address, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = generateCode();
    await this.prisma.loginCode.create({
      data: {
        email: address,
        codeHash: await bcrypt.hash(code, BCRYPT_ROUNDS),
        expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000),
      },
    });

    await this.mailer.send(loginCodeEmail(address, code, TTL_MINUTES));
  }

  /**
   * Check `code` against the newest live code for `email`, consuming it on a
   * match. Throws 401 on any failure.
   */
  async verifyCode(email: string, code: string): Promise<void> {
    const address = normaliseEmail(email);

    const record = await this.prisma.loginCode.findFirst({
      where: { email: address, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    // No code, expired, or already used — all the same to the caller. Which one
    // it was is a hint we don't owe anyone guessing at an address.
    if (!record) {
      throw invalidCode();
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      // Burn it: leaving it live would let a guesser keep going by ignoring the
      // counter, and the real user can always request a new one.
      await this.consume(record.id);
      this.log.warn(`Login code for ${address} exhausted its attempts.`);
      throw invalidCode();
    }

    if (!(await bcrypt.compare(code, record.codeHash))) {
      await this.prisma.loginCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalidCode();
    }

    await this.consume(record.id);
  }

  private async enforceRequestRate(address: string): Promise<void> {
    const since = new Date(Date.now() - REQUEST_WINDOW_MINUTES * 60_000);
    const recent = await this.prisma.loginCode.count({
      where: { email: address, createdAt: { gt: since } },
    });

    if (recent >= MAX_REQUESTS_PER_WINDOW) {
      this.log.warn(`Rate-limited login code requests for ${address}.`);
      throw new TooManyCodeRequestsException(
        `Too many codes requested for this address. Try again in ${REQUEST_WINDOW_MINUTES} minutes.`,
      );
    }
  }

  private async consume(id: string): Promise<void> {
    await this.prisma.loginCode.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }
}

/**
 * A 6-digit code, zero-padded so every code is the same length.
 *
 * `randomInt` and not `Math.random`: the latter is seeded pseudo-randomness and
 * predictable from prior outputs, which for a login credential is a real hole.
 */
function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** One message for every failure mode, so nothing is inferable from the reply. */
function invalidCode(): UnauthorizedException {
  return new UnauthorizedException('That code is invalid or has expired.');
}
