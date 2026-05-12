import { z } from "zod";

const normalizeTag = (s: string) => s.trim().toLowerCase();

const TagsSchema = z
  .array(z.string().min(1).max(30))
  .max(10)
  .transform((arr) => Array.from(new Set(arr.map(normalizeTag).filter(Boolean))));

export const MealIngredientInputSchema = z
  .object({
    ingredientId: z.string().uuid().nullable().optional(),
    displayText: z.string().min(1).max(200).nullable().optional(),
    quantity: z.number().min(0).max(9999.999).nullable().optional(),
    unit: z.string().max(30).nullable().optional(),
    sortOrder: z.number().int().min(0).max(99).default(0),
  })
  .refine(
    (r) => Boolean(r.ingredientId) || Boolean(r.displayText && r.displayText.trim().length > 0),
    { message: "Either ingredientId or displayText is required" },
  );

export const MealCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  instructions: z.string().max(20_000).optional().nullable(),
  prepTimeMinutes: z.number().int().min(0).max(999).optional().nullable(),
  cookTimeMinutes: z.number().int().min(0).max(999).optional().nullable(),
  servings: z.number().int().min(1).max(99).optional().nullable(),
  sourceUrl: z.string().url().max(500).optional().nullable(),
  tags: TagsSchema.default([]),
  ingredients: z.array(MealIngredientInputSchema).max(50).default([]),
});

export const MealUpdateSchema = MealCreateSchema.partial();

export type MealCreate = z.infer<typeof MealCreateSchema>;
export type MealUpdate = z.infer<typeof MealUpdateSchema>;
export type MealIngredientInput = z.infer<typeof MealIngredientInputSchema>;
