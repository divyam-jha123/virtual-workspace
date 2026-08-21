import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { LocalStorage } from "./storage/local-storage.js";
import type { Storage } from "./storage/storage.js";

/** Everything a route handler needs, injected so tests can swap pieces. */
export interface AppContext {
  config: Config;
  prisma: PrismaClient;
  storage: Storage;
}

export function createContext(config: Config, prisma: PrismaClient, storage?: Storage): AppContext {
  return { config, prisma, storage: storage ?? new LocalStorage(config.storageDir) };
}
