// src/components/calendar/eat-out-form.tsx
"use client";

import { useState } from "react";

export function EatOutForm({
  initialCost,
  initialLabel,
  onChange,
}: {
  initialCost: number | null;
  initialLabel: string | null;
  onChange: (cost: number | null, label: string | null) => void;
}) {
  const [cost, setCost] = useState(initialCost?.toString() ?? "");
  const [label, setLabel] = useState(initialLabel ?? "");
  return (
    <div className="space-y-2">
      <input
        type="number"
        step="0.01"
        min="0"
        max="9999.99"
        placeholder="Cost (optional)"
        value={cost}
        onChange={(e) => {
          setCost(e.target.value);
          const n = e.target.value === "" ? null : Number(e.target.value);
          onChange(Number.isFinite(n as number) ? (n as number | null) : null, label.trim() || null);
        }}
        className="w-full rounded border px-2 py-1 text-sm"
      />
      <input
        type="text"
        placeholder="Label (e.g. Chipotle)"
        value={label}
        maxLength={80}
        onChange={(e) => {
          setLabel(e.target.value);
          const n = cost === "" ? null : Number(cost);
          onChange(Number.isFinite(n as number) ? (n as number | null) : null, e.target.value.trim() || null);
        }}
        className="w-full rounded border px-2 py-1 text-sm"
      />
    </div>
  );
}
