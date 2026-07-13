import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST /realtime/token`. Identity and display name are derived from
 * the authenticated user (JWT) — never trusted from the client — so the caller
 * only picks which room to join.
 */
export class CreateTokenDto {
  /** LiveKit room to join. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  roomName!: string;
}
