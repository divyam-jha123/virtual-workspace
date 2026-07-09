import { Module } from '@nestjs/common';
import { RealtimeController } from './token/realtime.controller';
import { TokenService } from './token/token.service';

@Module({
  controllers: [RealtimeController],
  providers: [TokenService],
})
export class RealtimeModule {}
