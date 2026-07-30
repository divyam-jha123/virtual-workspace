import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';

/** Decode the payload segment of a JWT without verifying the signature. */
function decodeJwtPayload(jwt: string): Record<string, any> {
  const [, payload] = jwt.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

describe('TokenService', () => {
  const env: Record<string, string> = {
    LIVEKIT_URL: 'wss://example.livekit.cloud',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'devsecretdevsecretdevsecretdevsecret',
  };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const service = new TokenService(config);

  it('exposes the configured LiveKit URL', () => {
    expect(service.livekitUrl).toBe(env.LIVEKIT_URL);
  });

  it('mints a JWT granting room join + publish + subscribe + data', async () => {
    const jwt = await service.createToken({
      roomName: 'spike-room',
      identity: 'clientA',
      name: 'Client A',
    });

    expect(typeof jwt).toBe('string');
    expect(jwt.split('.')).toHaveLength(3);

    const payload = decodeJwtPayload(jwt);
    expect(payload.sub).toBe('clientA');
    expect(payload.video.room).toBe('spike-room');
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.canSubscribe).toBe(true);
    expect(payload.video.canPublishData).toBe(true);
  });

  it('scopes publishing to camera + microphone only', async () => {
    const jwt = await service.createToken({
      roomName: 'spike-room',
      identity: 'clientA',
    });

    const payload = decodeJwtPayload(jwt);
    expect(payload.video.canPublishSources).toEqual(['camera', 'microphone']);
    expect(payload.video.canPublishSources).not.toContain('screen_share');
    expect(payload.video.canPublishSources).not.toContain(
      'screen_share_audio',
    );
  });

  it('sets an explicit 6h expiry', async () => {
    const before = Math.floor(Date.now() / 1000);
    const jwt = await service.createToken({
      roomName: 'spike-room',
      identity: 'clientA',
    });
    const after = Math.floor(Date.now() / 1000);

    const payload = decodeJwtPayload(jwt);
    const sixHours = 6 * 60 * 60;
    expect(payload.exp).toBeGreaterThanOrEqual(before + sixHours);
    expect(payload.exp).toBeLessThanOrEqual(after + sixHours);
  });
});
