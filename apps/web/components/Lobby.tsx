"use client";

import { useOffices } from "./OfficesProvider";
import { DefaultState } from "./DefaultState";
import { EmptyState } from "./EmptyState";

/** Shows the empty state when there are no offices, otherwise the grid. */
export function Lobby() {
  const { offices } = useOffices();
  return offices.length === 0 ? <EmptyState /> : <DefaultState />;
}
