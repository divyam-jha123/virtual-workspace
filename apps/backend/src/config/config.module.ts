import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

/** Env vars the backend cannot boot without. */
const REQUIRED = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;

/**
 * Fail fast at boot if any LiveKit credential is missing, rather than surfacing
 * a confusing error only when the first token is requested.
 */
function validate(env: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `Copy .env.example to .env and fill in your LiveKit Cloud credentials.`,
    );
  }
  return env;
}

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
  ],
})
export class ConfigModule {}
