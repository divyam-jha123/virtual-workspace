import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body for `POST /auth/login`. */
export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  password!: string;
}
