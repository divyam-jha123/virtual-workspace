import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { LiveKitWebhookService } from './livekit-webhook.service';

/**
 * Webhook sink for LiveKit Cloud (#26). Configure the URL in the LiveKit
 * project settings to point at `POST /realtime/webhooks/livekit`.
 *
 * Deliberately unauthenticated at the HTTP layer: LiveKit authenticates itself
 * via a signed `Authorization` header that {@link LiveKitWebhookService} checks
 * against the raw body. The raw body is required — see `rawBody: true` in
 * `main.ts` — because any re-serialization would invalidate the signature.
 */
@Controller('realtime/webhooks')
export class LiveKitWebhookController {
  constructor(private readonly webhooks: LiveKitWebhookService) {}

  @Post('livekit')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authHeader?: string,
  ): Promise<void> {
    const body = req.rawBody?.toString('utf8') ?? '';
    await this.webhooks.handle(body, authHeader);
  }
}
