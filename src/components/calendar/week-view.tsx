// src/components/calendar/week-view.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MealSlot, ResolvedWeek } from "@/lib/schedule/types";
import { DayAgenda } from "./day-agenda";
import { WeekGrid } from "./week-grid";
import { SlotEditor } from "./slot-editor";

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

type OpenEditor = { dateISO: string; slot: MealSlot } | null;

export function WeekView({
  week,
  profileColors: _profileColors,
}: {
  week: ResolvedWeek;
  profileColors: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenEditor>(null);

  const handleOpen = (dateISO: string, slot: MealSlot) => setOpen({ dateISO, slot });

  return (
    <>
      <div className="md:hidden space-y-3">
        {week.days.map((day, i) => {
          const dateISO = addDays(week.weekStart, i);
          return (
            <DayAgenda
              key={dateISO}
              dateISO={dateISO}
              day={day}
              overrideSlots={week.overrideMap[dateISO] ?? []}
              onSlotClick={(slot) => handleOpen(dateISO, slot)}
            />
          );
        })}
      </div>
      <div className="hidden md:block">
        <WeekGrid week={week} onSlotClick={handleOpen} />
      </div>
      {open && (
        <SlotEditor
          dateISO={open.dateISO}
          slot={open.slot}
          currentState={
            week.days[
              Math.round(
                (Date.UTC(
                  Number(open.dateISO.slice(0, 4)),
                  Number(open.dateISO.slice(5, 7)) - 1,
                  Number(open.dateISO.slice(8, 10)),
                ) -
                  Date.UTC(
                    Number(week.weekStart.slice(0, 4)),
                    Number(week.weekStart.slice(5, 7)) - 1,
                    Number(week.weekStart.slice(8, 10)),
                  )) /
                  (24 * 60 * 60 * 1000),
              )
            ]?.[open.slot] ?? { kind: "empty" }
          }
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
