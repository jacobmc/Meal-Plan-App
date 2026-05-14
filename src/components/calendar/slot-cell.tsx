// src/components/calendar/slot-cell.tsx
"use client";

import type { ResolvedSlot, MealSlot } from "@/lib/schedule/types";

export function SlotCell({
  slot,
  state,
  hasOverride,
  onClick,
}: {
  slot: MealSlot;
  state: ResolvedSlot;
  hasOverride: boolean;
  onClick: () => void;
}) {
  const label =
    state.kind === "meal"
      ? state.meal.name
      : state.kind === "eat-out"
        ? `🍴 ${state.entry.eatingOutLabel ?? "Eating out"}`
        : "—";
  const isOverride = state.kind !== "empty" && state.source === "override";
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border hover:bg-muted/50 flex w-full items-center justify-between rounded border px-2 py-1 text-left text-sm"
      aria-label={`Edit ${slot}`}
    >
      <span className="truncate">{label}</span>
      <span className="flex items-center gap-1">
        {state.kind !== "empty" && state.entry.notes && <span aria-label="has note">📝</span>}
        {isOverride && <span className="text-xs text-blue-600">override</span>}
        {!isOverride && hasOverride && <span className="text-xs text-blue-600">•</span>}
      </span>
    </button>
  );
}
