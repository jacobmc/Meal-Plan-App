"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/http/fetcher";
import type { IngredientCategory } from "@/lib/validation/ingredient";

export interface IngredientChoice {
  id: string;
  name: string;
}

interface ApiIngredient extends IngredientChoice {
  defaultUnit: string | null;
  category: IngredientCategory;
}

export interface IngredientComboboxProps {
  value: IngredientChoice | null;        // null when row uses displayText only
  freeText: string;                       // displayText draft
  onChooseIngredient: (i: IngredientChoice) => void;
  onChangeFreeText: (s: string) => void;
  onCreated?: (i: ApiIngredient) => void;
}

export function IngredientCombobox({
  value,
  freeText,
  onChooseIngredient,
  onChangeFreeText,
  onCreated,
}: IngredientComboboxProps) {
  const [query, setQuery] = useState(value?.name ?? freeText ?? "");
  const [results, setResults] = useState<ApiIngredient[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api<{ items: ApiIngredient[] }>(
          `/api/ingredients?q=${encodeURIComponent(query)}`,
        );
        setResults(r.items);
      } catch {
        setResults([]);
      }
    }, 200);
  }, [query]);

  async function createNew() {
    setCreating(true);
    try {
      const created = await api<ApiIngredient>("/api/ingredients", {
        method: "POST",
        body: JSON.stringify({ name: query, category: "other" }),
      });
      onChooseIngredient({ id: created.id, name: created.name });
      onCreated?.(created);
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  const exactMatch = results.find(
    (r) => r.name.toLowerCase() === query.trim().toLowerCase(),
  );
  const canCreate = query.trim().length > 0 && !exactMatch;

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChangeFreeText(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Ingredient or free text"
        className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {open ? (
        <ul className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 text-sm shadow-md max-h-64 overflow-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChooseIngredient({ id: r.id, name: r.name });
                  setQuery(r.name);
                  setOpen(false);
                }}
                className="w-full rounded px-2 py-1 text-left hover:bg-muted"
              >
                <span>{r.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{r.category}</span>
              </button>
            </li>
          ))}
          {canCreate ? (
            <li>
              <button
                type="button"
                disabled={creating}
                onMouseDown={(e) => e.preventDefault()}
                onClick={createNew}
                className="w-full rounded px-2 py-1 text-left text-primary hover:bg-muted"
              >
                {creating ? "Creating…" : `Create new ingredient "${query.trim()}"`}
              </button>
            </li>
          ) : null}
          {results.length === 0 && !canCreate ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">No matches.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
