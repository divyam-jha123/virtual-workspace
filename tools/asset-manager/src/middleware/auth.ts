import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../lib/errors.js";

/**
 * Guards /v1. Accepts the key as `Authorization: Bearer <key>` OR `X-API-Key`,
 * because the MCP sends both. Constant-ish comparison; single static key.
 */
export function requireApiKey(apiKey: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const header = String(req.headers["x-api-key"] ?? "").trim();
    if (bearer === apiKey || header === apiKey) {
      next();
      return;
    }
    next(unauthorized("Missing or invalid API key. Send Authorization: Bearer <key> or X-API-Key."));
  };
}
