// src/components/calendar/slot-editor.tsx
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { MealSlot, ResolvedSlot } from "@/lib/schedule/types";
import { Button } from "@/components/ui/button";
import { MealPicker } from "./meal-picker";
import { EatOutForm } from "./eat-out-form";
import { NotesInput } from "./notes-input";

type Mode = "meal" | "eat-out";

export function SlotEditor({
  dateISO,
  slot,
  currentState,
  onClose,
  onSaved,
}: {
  dateISO: string;
  slot: MealSlot;
  currentState: ResolvedSlot;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sp = useSearchParams();
  const profileParam = sp.get("profile");
  const profileId = profileParam && profileParam !== "default" ? profileParam : null;

  const existingId = currentState.kind !== "empty" ? currentState.entry.id : null;
  // If we're viewing a profile and the resolved row is the default, treat the editor
  // as creating an override, not editing the default.
  const isOverrideEdit = profileId !== null && (currentState.kind === "empty" || currentState.source === "override");
  const targetProfileId = profileId;

  const [mode, setMode] = useState<Mode>(currentState.kind === "eat-out" ? "eat-out" : "meal");
  const [mealId, setMealId] = useState<string | null>(
    currentState.kind === "meal" ? currentState.entry.mealId : null,
  );
  const [eatCost, setEatCost] = useState<number | null>(
    currentState.kind === "eat-out" ? currentState.entry.eatingOutCost : null,
  );
  const [eatLabel, setEatLabel] = useState<string | null>(
    currentState.kind === "eat-out" ? currentState.entry.eatingOutLabel : null,
  );
  const [notes, setNotes] = useState<string | null>(
    currentState.kind !== "empty" ? currentState.entry.notes : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { date: dateISO, slot, notes };
      if (isOverrideEdit) body.profileId = targetProfileId;
      if (mode === "meal") {
        if (!mealId) {
          setError("Pick a meal or switch to Eating out.");
          setSaving(false);
          return;
        }
        body.mealId = mealId;
        body.eatingOut = false;
      } else {
        body.eatingOut = true;
        body.eatingOutCost = eatCost;
        body.eatingOutLabel = eatLabel;
      }

      let res: Response;
      if (existingId && (isOverrideEdit ? currentState.kind !== "empty" && currentState.source === "override" : true)) {
        res = await fetch(`/api/schedule/entries/${existingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/schedule/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error?.message ?? "Failed to save");
        setSaving(false);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function clearSlot() {
    if (!existingId) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule/entries/${existingId}`, { method: "DELETE" });
      if (!res.ok) { setError("Failed to clear"); setSaving(false); return; }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div className="bg-background w-full max-w-md space-y-3 rounded-t-lg p-4 md:rounded-lg">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {dateISO} · {slot} {isOverrideEdit && <span className="text-muted-foreground text-xs">(override)</span>}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "meal" ? "default" : "outline"} onClick={() => setMode("meal")}>
            Pick meal
          </Button>
          <Button size="sm" variant={mode === "eat-out" ? "default" : "outline"} onClick={() => setMode("eat-out")}>
            Eating out
          </Button>
        </div>
        {mode === "meal" ? (
          <MealPicker value={mealId} onChange={setMealId} />
        ) : (
          <EatOutForm initialCost={eatCost} initialLabel={eatLabel} onChange={(c, l) => { setEatCost(c); setEatLabel(l); }} />
        )}
        <NotesInput initial={notes} onChange={setNotes} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <footer className="flex items-center justify-between pt-2">
          {existingId && (
            <Button size="sm" variant="outline" onClick={clearSlot} disabled={saving}>
              Clear
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>Save</Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
