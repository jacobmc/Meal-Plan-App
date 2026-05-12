import { z } from "zod";

export const INGREDIENT_CATEGORIES = [
  "produce",
  "meat",
  "dairy",
  "pantry",
  "frozen",
  "bakery",
  "other",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ");

export const IngredientCreateSchema = z.object({
  name: z
    .string()
    .transform(normalizeName)
    .pipe(z.string().min(1).max(80)),
  defaultUnit: z.string().max(30).optional().nullable(),
  category: z.enum(INGREDIENT_CATEGORIES),
});

export type IngredientCreate = z.infer<typeof IngredientCreateSchema>;
