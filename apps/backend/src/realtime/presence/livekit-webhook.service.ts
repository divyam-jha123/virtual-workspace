import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookReceiver } from 'livekit-server-sdk';
import { PresenceService } from './presence.service';

/**
 * Receives and verifies LiveKit webhooks, then feeds presence-relevant events
 * into {@link PresenceService} (#26).
 *
 * LiveKit signs each webhook with a JWT (the `Authorization` header) whose
 * `sha256` claim must match a hash of the raw request body. Verification uses
 * the same API key/secret we mint join tokens with, so only LiveKit Cloud can
 * drive our presence state — the endpoint itself needs no user auth.
 */
@Injectable()
export class LiveKitWebhookService {
  private readonly logger = new Logger(LiveKitWebhookService.name);
  private readonly receiver: WebhookReceiver;

  constructor(
    config: ConfigService,
    private readonly presence: PresenceService,
  ) {
    // Presence guaranteed by ConfigModule's boot-time validation.
    const apiKey = config.get<string>('LIVEKIT_API_KEY')!;
    const apiSecret = config.get<string>('LIVEKIT_API_SECRET')!;
    this.receiver = new WebhookReceiver(apiKey, apiSecret);
  }

  /**
   * Verify a raw webhook request and apply it. `body` must be the *exact* bytes
   * LiveKit posted (any re-serialization breaks the signature).
   */
  async handle(body: string, authHeader?: string): Promise<void> {
    let event;
    try {
      event = await this.receiver.receive(body, authHeader);
    } catch (err) {
      this.logger.warn(`rejected webhook: ${(err as Error).message}`);
      throw new UnauthorizedException('invalid webhook signature');
    }

    const roomName = event.room?.name;
    const participant = event.participant;

    switch (event.event) {
      case 'participant_joined':
        if (roomName && participant) {
          await this.presence.participantJoined({
            roomName,
            identity: participant.identity,
            displayName: participant.name || undefined,
          });
        }
        break;

      case 'participant_left':
        if (roomName && participant) {
          await this.presence.participantLeft({
            roomName,
            identity: participant.identity,
            displayName: participant.name || undefined,
          });
        }
        break;

      case 'room_finished':
        if (roomName) {
          await this.presence.roomFinished(roomName);
        }
        break;

      default:
        // Other events (track_*, egress_*, room_started, …) carry no presence
        // metadata we persist. Acknowledge them so LiveKit stops retrying.
        this.logger.debug(`ignoring webhook event: ${event.event}`);
    }
  }
}
