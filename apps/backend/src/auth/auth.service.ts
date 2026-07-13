import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

/** Claims carried in the signed JWT. `sub` is the LiveKit identity. */
export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
}

export interface LoginResponse {
  accessToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  /** Return the user when the password matches, otherwise null. */
  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return null;
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    return matches ? user : null;
  }

  /** Validate credentials and issue a signed JWT, or throw 401. */
  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.displayName,
    };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}
