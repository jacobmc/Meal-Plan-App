// src/components/calendar/meal-picker.tsx
"use client";

import { useEffect, useState } from "react";

type MealOption = { id: string; name: string };

export function MealPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (mealId: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<MealOption[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const ctrl = new AbortController();
    const run = async () => {
      const url = q.trim().length > 0 ? `/api/meals?q=${encodeURIComponent(q)}` : `/api/meals`;
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { items: MealOption[] };
        if (!cancel) setOptions(body.items.slice(0, 30));
      } catch { /* aborted */ }
    };
    const t = setTimeout(run, 200);
    return () => { cancel = true; ctrl.abort(); clearTimeout(t); };
  }, [q]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder={selectedName ?? "Search meals…"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded border px-2 py-1 text-sm"
      />
      <ul className="max-h-48 overflow-auto rounded border">
        {options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => { onChange(o.id); setSelectedName(o.name); }}
              className={`hover:bg-muted/50 w-full px-2 py-1 text-left text-sm ${value === o.id ? "bg-muted" : ""}`}
            >
              {o.name}
            </button>
          </li>
        ))}
        {options.length === 0 && <li className="text-muted-foreground px-2 py-2 text-sm">No matches</li>}
      </ul>
    </div>
  );
}
