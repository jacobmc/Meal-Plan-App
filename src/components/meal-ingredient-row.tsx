"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IngredientCombobox, type IngredientChoice } from "./ingredient-combobox";

export interface IngredientRowValue {
  rowId: string;                           // client-only stable key
  ingredient: IngredientChoice | null;
  displayText: string;
  quantity: number | "";
  unit: string;
}

export interface MealIngredientRowProps {
  row: IngredientRowValue;
  onChange: (next: IngredientRowValue) => void;
  onRemove: () => void;
}

export function MealIngredientRow({ row, onChange, onRemove }: MealIngredientRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.rowId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-md border bg-background p-2"
    >
      <button
        type="button"
        aria-label="Drag handle"
        className="cursor-grab select-none px-1 text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <div className="flex flex-1 flex-col gap-1.5">
        <IngredientCombobox
          value={row.ingredient}
          freeText={row.displayText}
          onChooseIngredient={(ing) =>
            onChange({ ...row, ingredient: ing, displayText: "" })
          }
          onChangeFreeText={(s) =>
            onChange({ ...row, ingredient: null, displayText: s })
          }
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step="0.001"
            value={row.quantity}
            onChange={(e) =>
              onChange({
                ...row,
                quantity: e.target.value === "" ? "" : Number(e.target.value),
              })
            }
            placeholder="Qty"
            className="w-20 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={row.unit}
            onChange={(e) => onChange({ ...row, unit: e.target.value })}
            placeholder="Unit"
            maxLength={30}
            className="w-24 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove ingredient"
        className="text-muted-foreground hover:text-destructive"
      >
        ×
      </button>
    </li>
  );
}
