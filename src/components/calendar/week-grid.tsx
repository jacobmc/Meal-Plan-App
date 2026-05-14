// src/components/calendar/week-grid.tsx
"use client";

import { MEAL_SLOTS, type ResolvedWeek } from "@/lib/schedule/types";
import { SlotCell } from "./slot-cell";

const SLOT_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function WeekGrid({
  week,
  onSlotClick,
}: {
  week: ResolvedWeek;
  onSlotClick: (dateISO: string, slot: (typeof MEAL_SLOTS)[number]) => void;
}) {
  const dates = week.days.map((_, i) => addDays(week.weekStart, i));
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <thead>
        <tr>
          <th className="w-20 text-left"></th>
          {dates.map((d) => (
            <th key={d} className="border-b px-1 py-1 text-left">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {MEAL_SLOTS.map((slot) => (
          <tr key={slot}>
            <th className="text-muted-foreground py-1 pr-2 text-left text-xs">{SLOT_LABEL[slot]}</th>
            {week.days.map((day, i) => {
              const dateISO = dates[i]!;
              return (
                <td key={dateISO} className="p-1 align-top">
                  <SlotCell
                    slot={slot}
                    state={day[slot]}
                    hasOverride={(week.overrideMap[dateISO] ?? []).includes(slot)}
                    onClick={() => onSlotClick(dateISO, slot)}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
