import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

/** Env vars the backend cannot boot without. */
const REQUIRED = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'DATABASE_URL',
  'JWT_SECRET',
  // Google sign-in is a login path in the UI, so without this nobody can get in
  // that way at all — fail at boot rather than at the first sign-in attempt.
  'GOOGLE_CLIENT_ID',
  // The From address on login-code emails. A wrong or unverified one fails
  // delivery silently at the provider, so catch it at boot. RESEND_API_KEY is
  // deliberately NOT required: without it the backend logs codes instead of
  // sending them, which is the zero-setup local dev path (see mail.module.ts).
  'MAIL_FROM',
] as const;

/**
 * Fail fast at boot if a required env var is missing, rather than surfacing a
 * confusing error only when the first token is requested or the DB is first hit.
 */
function validate(env: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `Copy .env.example to .env and fill in your LiveKit Cloud credentials ` +
        `and DATABASE_URL (local Postgres from infra/docker/docker-compose.yml).`,
    );
  }
  return env;
}

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Credentials live in the monorepo-root .env; also honour a backend-local
      // .env if present. First match wins.
      envFilePath: ['.env', '../../.env'],
      validate,
    }),
  ],
})
export class ConfigModule {}
