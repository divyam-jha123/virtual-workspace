import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LiveKitWebhookController } from './presence/livekit-webhook.controller';
import { LiveKitWebhookService } from './presence/livekit-webhook.service';
import { PresenceService } from './presence/presence.service';
import { RealtimeController } from './token/realtime.controller';
import { TokenService } from './token/token.service';

@Module({
  imports: [AuthModule],
  controllers: [RealtimeController, LiveKitWebhookController],
  providers: [TokenService, PresenceService, LiveKitWebhookService],
  exports: [PresenceService],
})
export class RealtimeModule {}
