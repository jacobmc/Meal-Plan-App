"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "@/lib/http/fetcher";

export interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function TagInput({ value, onChange, max = 10 }: TagInputProps) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      api<{ items: string[] }>("/api/meals/tags")
        .then((r) => setSuggestions(r.items))
        .catch(() => setSuggestions([]));
    }
  }, []);

  function commit(raw: string) {
    const t = norm(raw);
    if (!t || t.length > 30) return;
    if (value.includes(t)) return;
    if (value.length >= max) return;
    onChange([...value, t]);
    setInput("");
    setOpen(false);
  }

  function remove(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(input);
    } else if (e.key === "Backspace" && input.length === 0 && value.length > 0) {
      remove(value[value.length - 1]!);
    }
  }

  const filtered = input
    ? suggestions.filter(
        (s) => s.startsWith(norm(input)) && !value.includes(s),
      )
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5 rounded-md border bg-background p-1.5">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
          >
            {t}
            <button
              type="button"
              onClick={() => remove(t)}
              aria-label={`Remove ${t}`}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          onKeyDown={onKey}
          placeholder={value.length === 0 ? "Add tag (press Enter)" : ""}
          className="flex-1 min-w-[8ch] bg-transparent text-sm focus:outline-none"
        />
      </div>
      {open && filtered.length > 0 ? (
        <ul className="rounded-md border bg-popover p-1 text-sm shadow-md">
          {filtered.slice(0, 8).map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(s)}
                className="w-full rounded px-2 py-1 text-left hover:bg-muted"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
