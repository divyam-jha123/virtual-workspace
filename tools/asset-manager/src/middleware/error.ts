import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors.js";

/** Central error serializer. Never leaks stack traces or filesystem paths. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.code, message: err.message, ...(err.fix ? { fix: err.fix } : {}) });
    return;
  }
  // Multer and other library errors expose a `.message` but nothing sensitive we forward.
  const message = err instanceof Error ? err.message : "Internal error";
  // eslint-disable-next-line no-console
  console.error("[asset-manager] unhandled:", err);
  res.status(500).json({ error: "internal_error", message });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "not_found", message: "No such endpoint" });
}
