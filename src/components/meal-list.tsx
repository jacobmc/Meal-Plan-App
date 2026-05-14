"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/http/fetcher";
import { MealListItem, type MealSummary } from "./meal-list-item";

export interface MealListProps {
  initialItems: MealSummary[];
  initialQuery: string;
  initialTags: string[];
}

export function MealList({ initialItems, initialQuery, initialTags }: MealListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(initialQuery);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [allTags, setAllTags] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api<{ items: string[] }>("/api/meals/tags")
      .then((r) => setAllTags(r.items))
      .catch(() => setAllTags([]));
  }, []);

  function pushUrl(nextQ: string, nextTags: string[]) {
    const sp = new URLSearchParams();
    if (nextQ) sp.set("q", nextQ);
    for (const t of nextTags) sp.append("tag", t);
    const qs = sp.toString();
    startTransition(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  }

  function onQChange(v: string) {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushUrl(v, tags), 200);
  }

  function toggleTag(t: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    setTags(next);
    pushUrl(q, next);
  }

  function clearAll() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQ("");
    setTags([]);
    pushUrl("", []);
  }

  const hasFilters = q.length > 0 || tags.length > 0;
  const items = initialItems;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Recipes</h2>
        <div className="flex items-center gap-2">
          <Link href="/app/calendar" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Plan a week →
          </Link>
          <Link href="/app/meals/new" className={buttonVariants()}>
            New recipe
          </Link>
        </div>
      </div>

      <Input
        placeholder="Search by name…"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
      />

      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const on = tags.includes(t);
            return (
              <button
                type="button"
                key={t}
                onClick={() => toggleTag(t)}
                className={
                  "rounded-full border px-2 py-0.5 text-xs " +
                  (on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground")
                }
              >
                {t}
              </button>
            );
          })}
        </div>
      ) : null}

      {items.length === 0 ? (
        hasFilters ? (
          <div className="rounded-md border bg-card p-6 text-sm">
            No recipes match.{" "}
            <button type="button" onClick={clearAll} className="underline">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="rounded-md border bg-card p-6 text-center">
            <p className="mb-3">Build your first recipe.</p>
            <Link href="/app/meals/new" className={buttonVariants()}>
              New recipe
            </Link>
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => (
            <MealListItem key={m.id} meal={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
