// src/components/calendar/notes-input.tsx
"use client";

import { useState } from "react";

export function NotesInput({
  initial,
  onChange,
}: {
  initial: string | null;
  onChange: (v: string | null) => void;
}) {
  const [v, setV] = useState(initial ?? "");
  return (
    <input
      type="text"
      placeholder="Notes (optional)"
      value={v}
      maxLength={500}
      onChange={(e) => {
        const next = e.target.value;
        setV(next);
        onChange(next.trim().length > 0 ? next : null);
      }}
      className="w-full rounded border px-2 py-1 text-sm"
    />
  );
}
