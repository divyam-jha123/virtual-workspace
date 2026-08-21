import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest } from "../lib/errors.js";

/** Wrap an async handler so thrown errors reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw badRequest("invalid_input", `${first?.path.join(".") || "body"}: ${first?.message}`);
  }
  return result.data;
}
