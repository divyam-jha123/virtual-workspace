import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body for `POST /auth/google`: the ID token from Google's sign-in popup. */
export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  // Google ID tokens are ~1KB; the cap just bounds what we hand to the verifier.
  @MaxLength(4096)
  idToken!: string;
}
