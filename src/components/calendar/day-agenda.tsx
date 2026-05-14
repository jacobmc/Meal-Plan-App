// src/components/calendar/day-agenda.tsx
"use client";

import { MEAL_SLOTS, type ResolvedDay } from "@/lib/schedule/types";
import { SlotCell } from "./slot-cell";

const SLOT_LABEL: Record<string, string> = {
  breakfast: "B",
  lunch: "L",
  dinner: "D",
  snack: "S",
};

export function DayAgenda({
  dateISO,
  day,
  overrideSlots,
  onSlotClick,
}: {
  dateISO: string;
  day: ResolvedDay;
  overrideSlots: string[];
  onSlotClick: (slot: (typeof MEAL_SLOTS)[number]) => void;
}) {
  return (
    <section className="rounded border p-3">
      <header className="mb-2 text-sm font-medium">{dateISO}</header>
      <div className="space-y-1">
        {MEAL_SLOTS.map((slot) => (
          <div key={slot} className="grid grid-cols-[24px_1fr] items-center gap-2">
            <span className="text-muted-foreground text-xs">{SLOT_LABEL[slot]}</span>
            <SlotCell
              slot={slot}
              state={day[slot]}
              hasOverride={overrideSlots.includes(slot)}
              onClick={() => onSlotClick(slot)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
