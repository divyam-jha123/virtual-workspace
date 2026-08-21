import { PrismaClient } from "@prisma/client";

/** One client per process. */
export const prisma = new PrismaClient();

export type { PrismaClient };
