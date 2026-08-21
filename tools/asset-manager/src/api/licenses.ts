import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { notFound } from "../lib/errors.js";
import { asyncHandler, parse } from "./http.js";

const licenseInput = z.object({
  name: z.string().min(1),
  licenseName: z.string().optional(),
  licenseUrl: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  author: z.string().optional(),
  attributionRequired: z.boolean().optional(),
  commercialUseAllowed: z.boolean().optional(),
  redistributionAllowed: z.boolean().optional(),
  notes: z.string().optional(),
});

export function createLicensesRouter(ctx: AppContext): Router {
  const router = Router();
  const { prisma } = ctx;

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      res.json({ items: await prisma.license.findMany({ orderBy: { name: "asc" } }) });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const data = parse(licenseInput, req.body);
      res.status(201).json(await prisma.license.create({ data }));
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const license = await prisma.license.findUnique({ where: { id: req.params.id } });
      if (!license) throw notFound("license not found");
      res.json(license);
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const data = parse(licenseInput.partial(), req.body);
      res.json(await prisma.license.update({ where: { id: req.params.id }, data }));
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await prisma.license.delete({ where: { id: req.params.id } });
      res.status(204).end();
    }),
  );

  return router;
}
