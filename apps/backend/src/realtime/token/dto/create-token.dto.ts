import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for `POST /realtime/token`. */
export class CreateTokenDto {
  /** LiveKit room to join. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  roomName!: string;

  /** Unique participant identity within the room. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  identity!: string;

  /** Optional human-readable display name. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;
}
