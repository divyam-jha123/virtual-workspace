import { Transform } from 'class-transformer';
import { IsEmail, Matches, MaxLength } from 'class-validator';
import { normaliseEmail } from '../email-code.service';

/** Body for `POST /auth/email/verify`: the address and the code from the email. */
export class VerifyEmailCodeDto {
  // See the note in RequestEmailCodeDto: normalise before @IsEmail sees it.
  @Transform(({ value }) => (typeof value === 'string' ? normaliseEmail(value) : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  // Trim only — the code is digits, and a pasted one often brings whitespace.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  // Exactly 6 digits. Rejecting anything else here means a malformed guess never
  // reaches bcrypt, which is deliberately slow.
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}
