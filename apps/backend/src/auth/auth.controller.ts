import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService, LoginResponse } from './auth.service';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RequestEmailCodeDto } from './dto/request-email-code.dto';
import { VerifyEmailCodeDto } from './dto/verify-email-code.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Exchange email + password for a signed JWT. Kept for dev and tests (see the
   * seeded users) — the UI signs in with Google.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.email, dto.password);
  }

  /** Exchange a Google ID token for a signed JWT. One of the UI's login paths. */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  loginWithGoogle(@Body() dto: GoogleLoginDto): Promise<LoginResponse> {
    return this.auth.loginWithGoogle(dto.idToken);
  }

  /**
   * Email a one-time login code, creating no account yet.
   *
   * 202, not 200: all this promises is that we've accepted the address and will
   * try to deliver — the send is a provider's problem by then. The reply is
   * identical for an address with an account and one without, which is free
   * here: signup and login are the same flow, so there's nothing to disclose.
   */
  @Post('email/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestEmailCode(@Body() dto: RequestEmailCodeDto): Promise<void> {
    await this.auth.requestEmailCode(dto.email);
  }

  /** Exchange a one-time code for a signed JWT — same token shape as Google. */
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  loginWithEmailCode(@Body() dto: VerifyEmailCodeDto): Promise<LoginResponse> {
    return this.auth.loginWithEmailCode(dto.email, dto.code);
  }
}
