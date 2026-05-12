"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/http/fetcher";
import { MarkdownEditor } from "./markdown-editor";
import { TagInput } from "./tag-input";
import {
  MealIngredientRow,
  type IngredientRowValue,
} from "./meal-ingredient-row";

export interface MealFormInitial {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
  sourceUrl: string | null;
  tags: string[];
  ingredients: Array<{
    ingredientId: string | null;
    ingredientName: string | null;
    displayText: string | null;
    quantity: string | null;     // numeric from DB serializes as string
    unit: string | null;
    sortOrder: number;
  }>;
}

let rowCounter = 0;
const nextRowId = () => `row_${++rowCounter}`;

function initRows(initial?: MealFormInitial): IngredientRowValue[] {
  if (!initial) return [];
  return initial.ingredients
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      rowId: nextRowId(),
      ingredient:
        r.ingredientId && r.ingredientName
          ? { id: r.ingredientId, name: r.ingredientName }
          : null,
      displayText: r.displayText ?? "",
      quantity: r.quantity != null ? Number(r.quantity) : "",
      unit: r.unit ?? "",
    }));
}

export function MealForm({ initial }: { initial?: MealFormInitial }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [prep, setPrep] = useState<number | "">(initial?.prepTimeMinutes ?? "");
  const [cook, setCook] = useState<number | "">(initial?.cookTimeMinutes ?? "");
  const [servings, setServings] = useState<number | "">(initial?.servings ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [rows, setRows] = useState<IngredientRowValue[]>(() => initRows(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function addRow() {
    setRows((rs) => [
      ...rs,
      { rowId: nextRowId(), ingredient: null, displayText: "", quantity: "", unit: "" },
    ]);
  }

  function updateRow(rowId: string, next: IngredientRowValue) {
    setRows((rs) => rs.map((r) => (r.rowId === rowId ? next : r)));
  }
  function removeRow(rowId: string) {
    setRows((rs) => rs.filter((r) => r.rowId !== rowId));
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setRows((rs) => {
      const from = rs.findIndex((r) => r.rowId === active.id);
      const to = rs.findIndex((r) => r.rowId === over.id);
      return arrayMove(rs, from, to);
    });
  }

  const ids = useMemo(() => rows.map((r) => r.rowId), [rows]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
        prepTimeMinutes: prep === "" ? undefined : prep,
        cookTimeMinutes: cook === "" ? undefined : cook,
        servings: servings === "" ? undefined : servings,
        sourceUrl: sourceUrl.trim() || undefined,
        tags,
        ingredients: rows.map((r, idx) => ({
          ingredientId: r.ingredient?.id ?? null,
          displayText: r.ingredient ? null : r.displayText.trim() || null,
          quantity: r.quantity === "" ? null : r.quantity,
          unit: r.unit.trim() || null,
          sortOrder: idx,
        })),
      };
      const saved = initial?.id
        ? await api<{ id: string }>(`/api/meals/${initial.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<{ id: string }>("/api/meals", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      router.push(`/app/meals/${saved.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ClientApiError) setError(err.message);
      else setError("Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!initial?.id) return;
    if (!confirm("Delete this recipe? This cannot be undone.")) return;
    setBusy(true);
    try {
      await api(`/api/meals/${initial.id}`, { method: "DELETE" });
      router.push("/app/meals");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prep">Prep (min)</Label>
            <Input
              id="prep"
              type="number"
              min={0}
              max={999}
              value={prep}
              onChange={(e) => setPrep(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cook">Cook (min)</Label>
            <Input
              id="cook"
              type="number"
              min={0}
              max={999}
              value={cook}
              onChange={(e) => setCook(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="servings">Servings</Label>
            <Input
              id="servings"
              type="number"
              min={1}
              max={99}
              value={servings}
              onChange={(e) => setServings(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sourceUrl">Source URL</Label>
          <Input
            id="sourceUrl"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            maxLength={500}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Ingredients</Label>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <MealIngredientRow
                  key={r.rowId}
                  row={r}
                  onChange={(next) => updateRow(r.rowId, next)}
                  onRemove={() => removeRow(r.rowId)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <Button type="button" variant="ghost" onClick={addRow} className="self-start">
          Add ingredient
        </Button>
      </section>

      <section className="flex flex-col gap-1.5">
        <Label>Instructions</Label>
        <MarkdownEditor value={instructions} onChange={setInstructions} />
      </section>

      <section className="flex flex-col gap-1.5">
        <Label>Tags</Label>
        <TagInput value={tags} onChange={setTags} />
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {initial?.id ? "Save" : "Create recipe"}
        </Button>
        {initial?.id ? (
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={busy}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}
