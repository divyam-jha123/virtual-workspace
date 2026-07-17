import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429 for the login-code send limit.
 *
 * Hand-rolled because `@nestjs/common` ships no TooManyRequestsException, and
 * `@nestjs/throttler` — whose ThrottlerException would be the obvious reuse —
 * isn't a dependency here: its default storage counts in-process, which is wrong
 * for a stateless backend meant to scale by instance count.
 */
export class TooManyCodeRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
