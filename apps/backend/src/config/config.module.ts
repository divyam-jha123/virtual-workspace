import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

/** Env vars the backend cannot boot without. */
const REQUIRED = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'DATABASE_URL',
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
