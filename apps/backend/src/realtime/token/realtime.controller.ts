import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthUser } from '../../auth/strategies/jwt.strategy';
import { CreateTokenDto } from './dto/create-token.dto';
import { TokenService } from './token.service';

export interface TokenResponse {
  token: string;
  url: string;
  roomName: string;
  identity: string;
}

@Controller('realtime')
@UseGuards(JwtAuthGuard)
export class RealtimeController {
  constructor(private readonly tokenService: TokenService) {}

  /**
   * Issue a LiveKit join token. The participant identity + display name come
   * from the authenticated user, so a client cannot impersonate anyone else.
   */
  @Post('token')
  async createToken(
    @Body() dto: CreateTokenDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TokenResponse> {
    const token = await this.tokenService.createToken({
      roomName: dto.roomName,
      identity: user.userId,
      name: user.name,
    });
    return {
      token,
      url: this.tokenService.livekitUrl,
      roomName: dto.roomName,
      identity: user.userId,
    };
  }
}
