import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

/** Exposes UsersService for the upcoming auth module to consume. */
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
