import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import { LiveKitWebhookService } from './livekit-webhook.service';
import { PresenceService } from './presence.service';

const API_KEY = 'devkey';
const API_SECRET = 'devsecretdevsecretdevsecretdevsecret';

const config = {
  get: (key: string) =>
    ({ LIVEKIT_API_KEY: API_KEY, LIVEKIT_API_SECRET: API_SECRET })[key],
} as unknown as ConfigService;

/** Sign a webhook body exactly as LiveKit does: a JWT carrying the body hash. */
async function signWebhook(body: string): Promise<string> {
  const sha256 = createHash('sha256').update(body).digest('base64');
  const at = new AccessToken(API_KEY, API_SECRET, { identity: API_KEY });
  at.sha256 = sha256;
  return at.toJwt();
}

describe('LiveKitWebhookService', () => {
  let presence: jest.Mocked<Pick<
    PresenceService,
    'participantJoined' | 'participantLeft' | 'roomFinished'
  >>;
  let service: LiveKitWebhookService;

  beforeEach(() => {
    presence = {
      participantJoined: jest.fn().mockResolvedValue(undefined),
      participantLeft: jest.fn().mockResolvedValue(undefined),
      roomFinished: jest.fn().mockResolvedValue(undefined),
    };
    service = new LiveKitWebhookService(
      config,
      presence as unknown as PresenceService,
    );
  });

  it('routes a signed participant_joined to PresenceService', async () => {
    const body = JSON.stringify({
      event: 'participant_joined',
      room: { name: 'spike-room' },
      participant: { identity: 'user-1', name: 'Ada' },
    });

    await service.handle(body, await signWebhook(body));

    expect(presence.participantJoined).toHaveBeenCalledWith({
      roomName: 'spike-room',
      identity: 'user-1',
      displayName: 'Ada',
    });
  });

  it('routes a signed participant_left to PresenceService', async () => {
    const body = JSON.stringify({
      event: 'participant_left',
      room: { name: 'spike-room' },
      participant: { identity: 'user-1', name: 'Ada' },
    });

    await service.handle(body, await signWebhook(body));

    expect(presence.participantLeft).toHaveBeenCalledWith({
      roomName: 'spike-room',
      identity: 'user-1',
      displayName: 'Ada',
    });
  });

  it('routes a signed room_finished to PresenceService', async () => {
    const body = JSON.stringify({
      event: 'room_finished',
      room: { name: 'spike-room' },
    });

    await service.handle(body, await signWebhook(body));

    expect(presence.roomFinished).toHaveBeenCalledWith('spike-room');
  });

  it('ignores non-presence events without touching PresenceService', async () => {
    const body = JSON.stringify({
      event: 'track_published',
      room: { name: 'spike-room' },
      participant: { identity: 'user-1' },
    });

    await service.handle(body, await signWebhook(body));

    expect(presence.participantJoined).not.toHaveBeenCalled();
    expect(presence.participantLeft).not.toHaveBeenCalled();
    expect(presence.roomFinished).not.toHaveBeenCalled();
  });

  it('rejects a body whose signature does not match', async () => {
    const body = JSON.stringify({
      event: 'participant_joined',
      room: { name: 'spike-room' },
      participant: { identity: 'user-1' },
    });
    // Sign a *different* body, then tamper.
    const authHeader = await signWebhook('{"event":"room_started"}');

    await expect(service.handle(body, authHeader)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(presence.participantJoined).not.toHaveBeenCalled();
  });

  it('rejects a missing authorization header', async () => {
    const body = JSON.stringify({ event: 'participant_joined' });

    await expect(service.handle(body, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
