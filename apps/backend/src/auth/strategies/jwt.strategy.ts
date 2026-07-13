import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../auth.service';

/** The authenticated principal attached to `request.user`. */
export interface AuthUser {
  userId: string;
  email: string;
  name: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  /** Passport calls this with the verified payload; its return becomes req.user. */
  validate(payload: JwtPayload): AuthUser {
    return { userId: payload.sub, email: payload.email, name: payload.name };
  }
}
