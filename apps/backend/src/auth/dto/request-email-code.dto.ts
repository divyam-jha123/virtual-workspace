import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { normaliseEmail } from '../email-code.service';

/** Body for `POST /auth/email/request`: the address to send a login code to. */
export class RequestEmailCodeDto {
  // Normalise before validating, not after: @IsEmail rejects the stray spaces a
  // real keyboard (or an autofill) leaves around an otherwise fine address.
  @Transform(({ value }) => (typeof value === 'string' ? normaliseEmail(value) : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
