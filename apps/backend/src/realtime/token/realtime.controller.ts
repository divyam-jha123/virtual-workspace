import { Body, Controller, Post } from '@nestjs/common';
import { CreateTokenDto } from './dto/create-token.dto';
import { TokenService } from './token.service';

export interface TokenResponse {
  token: string;
  url: string;
  roomName: string;
  identity: string;
}

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly tokenService: TokenService) {}

  /** Issue a LiveKit join token for a room + identity. */
  @Post('token')
  async createToken(@Body() dto: CreateTokenDto): Promise<TokenResponse> {
    const token = await this.tokenService.createToken(dto);
    return {
      token,
      url: this.tokenService.livekitUrl,
      roomName: dto.roomName,
      identity: dto.identity,
    };
  }
}
