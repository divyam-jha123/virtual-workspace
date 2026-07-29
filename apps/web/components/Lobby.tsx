"use client";

import { useOffices } from "./OfficesProvider";
import { DefaultState } from "./DefaultState";
import { EmptyState } from "./EmptyState";
import { LobbySkeleton } from "./LobbySkeleton";

/** Holds a skeleton until localStorage is read (so refresh never flashes the
 *  default state), then shows the empty state or the office grid. */
export function Lobby() {
  const { offices, hydrated } = useOffices();
  if (!hydrated) return <LobbySkeleton />;
  return offices.length === 0 ? <EmptyState /> : <DefaultState />;
}
