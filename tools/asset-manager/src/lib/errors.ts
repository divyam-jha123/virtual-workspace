/** An error that carries an HTTP status and a machine code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fix?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (code: string, message: string, fix?: string) =>
  new ApiError(400, code, message, fix);
export const unauthorized = (message = "Unauthorized") =>
  new ApiError(401, "unauthorized", message);
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const tooLarge = (message: string) => new ApiError(413, "payload_too_large", message);
export const unprocessable = (code: string, message: string, fix?: string) =>
  new ApiError(422, code, message, fix);
