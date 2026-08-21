import { randomBytes } from "node:crypto";
import type { Prisma, Selection } from "@prisma/client";
import type { AppContext } from "../context.js";
import { badRequest, notFound } from "../lib/errors.js";

/**
 * Selection sessions: one "which of these?" question, asked by the map MCP over
 * /v1 and answered by a person in the browser over /api.
 *
 * The token is the entire capability — the pick page is served from /api, which
 * has no login — so it is long, random, and short-lived. Nothing here trusts the
 * browser: the chosen id must be one of the candidates recorded when the question
 * was asked, so a crafted POST cannot select art that was never offered.
 */

export const DEFAULT_TTL_SECONDS = 900;
const MAX_TTL_SECONDS = 3600;
const MAX_CANDIDATES = 50;

export interface CreateSelectionInput {
  prompt: string;
  candidateIds: string[];
  ttlSeconds?: number;
}

/** 32 hex chars of CSPRNG. Guessing one is not a realistic attack. */
function newToken(): string {
  return randomBytes(16).toString("hex");
}

export async function createSelection(ctx: AppContext, input: CreateSelectionInput): Promise<Selection> {
  const candidateIds = [...new Set(input.candidateIds.filter((id) => typeof id === "string" && id.trim() !== ""))];
  if (candidateIds.length === 0) {
    throw badRequest("no-candidates", "A selection needs at least one candidate asset id.");
  }
  if (candidateIds.length > MAX_CANDIDATES) {
    throw badRequest("too-many-candidates", `A selection may offer at most ${MAX_CANDIDATES} assets.`);
  }
  const prompt = input.prompt.trim();
  if (prompt === "") throw badRequest("no-prompt", "A selection needs a prompt describing what is being chosen.");

  const ttl = Math.min(Math.max(input.ttlSeconds ?? DEFAULT_TTL_SECONDS, 30), MAX_TTL_SECONDS);
  return ctx.prisma.selection.create({
    data: {
      token: newToken(),
      prompt,
      candidateIds,
      expiresAt: new Date(Date.now() + ttl * 1000),
    },
  });
}

/**
 * Read a selection, retiring it first if its deadline has passed.
 *
 * Expiry is applied on read rather than by a background job: there is no
 * scheduler in this process, and a stale row that nobody looks at harms nothing.
 */
export async function readSelection(ctx: AppContext, token: string): Promise<Selection> {
  const selection = await ctx.prisma.selection.findUnique({ where: { token } });
  if (!selection) throw notFound("No such selection. It may have expired and been cleaned up.");

  if (selection.status === "pending" && selection.expiresAt.getTime() <= Date.now()) {
    return ctx.prisma.selection.update({
      where: { id: selection.id },
      data: { status: "expired", resolvedAt: new Date() },
    });
  }
  return selection;
}

/**
 * Record a choice. Only a pending selection can be answered, and only with an id
 * it actually offered — the candidate list is the allowlist.
 */
export async function chooseSelection(ctx: AppContext, token: string, assetId: string): Promise<Selection> {
  const selection = await readSelection(ctx, token);

  if (selection.status !== "pending") {
    throw badRequest("selection-resolved", `This selection is already ${selection.status}.`);
  }
  if (!selection.candidateIds.includes(assetId)) {
    throw badRequest("not-a-candidate", "That asset was not one of the options offered.");
  }

  // Conditional update: two browsers answering at once must not both win.
  const updated = await ctx.prisma.selection.updateMany({
    where: { id: selection.id, status: "pending" },
    data: { status: "chosen", chosenId: assetId, resolvedAt: new Date() },
  });
  if (updated.count === 0) throw badRequest("selection-resolved", "This selection was just answered elsewhere.");

  return readSelection(ctx, token);
}

export async function cancelSelection(ctx: AppContext, token: string): Promise<Selection> {
  const selection = await readSelection(ctx, token);
  if (selection.status !== "pending") return selection;
  return ctx.prisma.selection.update({
    where: { id: selection.id },
    data: { status: "cancelled", resolvedAt: new Date() },
  });
}

/** The shape both surfaces report status in. */
export function toSelectionStatus(selection: Selection, baseUrl?: string) {
  return {
    token: selection.token,
    prompt: selection.prompt,
    status: selection.status,
    candidateIds: selection.candidateIds,
    chosenId: selection.chosenId,
    expiresAt: selection.expiresAt.toISOString(),
    ...(baseUrl ? { url: `${baseUrl.replace(/\/$/, "")}/pick/${selection.token}` } : {}),
  };
}

/** Assets in the order they were offered, with their files, for the pick page. */
export async function selectionCandidates(ctx: AppContext, selection: Selection) {
  const include = { files: true, tileset: true, tags: true } as const;
  const rows = await ctx.prisma.asset.findMany({
    where: { slug: { in: selection.candidateIds } },
    include: include satisfies Prisma.AssetInclude,
  });
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  // Preserve the ranked order the MCP sent; drop anything since deleted.
  return selection.candidateIds.map((slug) => bySlug.get(slug)).filter((row): row is NonNullable<typeof row> => Boolean(row));
}
