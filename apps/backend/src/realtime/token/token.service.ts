import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

export interface CreateTokenParams {
  roomName: string;
  identity: string;
  name?: string;
}

/**
 * How long an issued join token stays valid. Long enough for a full workday
 * session without a refresh, short enough that a leaked token expires.
 */
export const TOKEN_TTL = '6h';

/**
 * Media a Phase 2 client is allowed to publish. Screen share stays locked
 * until Phase 3 ships the screen-share UI.
 */
export const PUBLISHABLE_SOURCES = [
  TrackSource.CAMERA,
  TrackSource.MICROPHONE,
];

/**
 * Mints LiveKit access tokens — the backend's *only* real-time role under
 * Option B. Position/presence/chat all ride LiveKit directly; the server never
 * relays game state.
 */
@Injectable()
export class TokenService {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(private readonly config: ConfigService) {
    // Presence guaranteed by ConfigModule's boot-time validation.
    this.apiKey = this.config.get<string>('LIVEKIT_API_KEY')!;
    this.apiSecret = this.config.get<string>('LIVEKIT_API_SECRET')!;
  }

  /** The public LiveKit websocket URL clients should connect to. */
  get livekitUrl(): string {
    return this.config.get<string>('LIVEKIT_URL')!;
  }

  /**
   * Build a signed join token. Publishing is scoped to camera + microphone;
   * `canSubscribe` and `canPublishData` stay on for client-driven proximity
   * subscriptions and the position data channel.
   */
  async createToken({
    roomName,
    identity,
    name,
  }: CreateTokenParams): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      name,
      ttl: TOKEN_TTL,
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishSources: PUBLISHABLE_SOURCES,
      canSubscribe: true,
      canPublishData: true,
    });
    return at.toJwt();
  }
}
