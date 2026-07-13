import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeController } from './token/realtime.controller';
import { TokenService } from './token/token.service';

@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [TokenService],
})
export class RealtimeModule {}
