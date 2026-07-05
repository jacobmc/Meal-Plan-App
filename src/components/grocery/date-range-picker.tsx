"use client";
import { useState } from "react";
import { formatISODate, weekStartFor } from "@/lib/schedule/week";
import { Button } from "@/components/ui/button";

type Value = { startDate: string; endDate: string };

function addDaysUTC(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

export function DateRangePicker({
  weekStartsOn,
  value,
  onChange,
}: {
  weekStartsOn: number;
  value: Value;
  onChange: (v: Value) => void;
}) {
  const [mode, setMode] = useState<"this" | "next" | "custom">("this");

  function setThisWeek() {
    const start = weekStartFor(new Date(), weekStartsOn);
    onChange({ startDate: formatISODate(start), endDate: formatISODate(addDaysUTC(start, 6)) });
    setMode("this");
  }

  function setNextWeek() {
    const start = addDaysUTC(weekStartFor(new Date(), weekStartsOn), 7);
    onChange({ startDate: formatISODate(start), endDate: formatISODate(addDaysUTC(start, 6)) });
    setMode("next");
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button type="button" variant={mode === "this" ? "default" : "outline"} onClick={setThisWeek}>
          This week
        </Button>
        <Button type="button" variant={mode === "next" ? "default" : "outline"} onClick={setNextWeek}>
          Next week
        </Button>
        <Button
          type="button"
          variant={mode === "custom" ? "default" : "outline"}
          onClick={() => setMode("custom")}
        >
          Custom
        </Button>
      </div>
      {mode === "custom" && (
        <div className="flex gap-3">
          <label className="text-sm">
            Start
            <input
              type="date"
              value={value.startDate}
              onChange={(e) => onChange({ ...value, startDate: e.target.value })}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
          <label className="text-sm">
            End
            <input
              type="date"
              value={value.endDate}
              onChange={(e) => onChange({ ...value, endDate: e.target.value })}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
