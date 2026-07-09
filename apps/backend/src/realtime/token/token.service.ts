import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';

export interface CreateTokenParams {
  roomName: string;
  identity: string;
  name?: string;
}

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

  /** Build a signed join token granting publish + subscribe + data. */
  async createToken({
    roomName,
    identity,
    name,
  }: CreateTokenParams): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      name,
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return at.toJwt();
  }
}
