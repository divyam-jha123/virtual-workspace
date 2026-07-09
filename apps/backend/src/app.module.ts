import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [ConfigModule, RealtimeModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
