import { z } from "zod";
import { INGREDIENT_CATEGORIES } from "@/lib/validation/ingredient";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const uuid = z.string().uuid();
const category = z.enum(INGREDIENT_CATEGORIES);

function daysBetween(a: string, b: string): number {
  const A = Date.parse(a + "T00:00:00Z");
  const B = Date.parse(b + "T00:00:00Z");
  return Math.floor((B - A) / (24 * 60 * 60 * 1000));
}

const dateRangeRefine = (
  data: { startDate: string; endDate: string },
  ctx: z.RefinementCtx,
) => {
  if (data.endDate < data.startDate) {
    ctx.addIssue({ code: "custom", message: "endDate must be on or after startDate" });
  }
  if (daysBetween(data.startDate, data.endDate) > 90) {
    ctx.addIssue({ code: "custom", message: "Date range too long (max 90 days)" });
  }
};

export const CreateGroceryListSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    startDate: isoDate,
    endDate: isoDate,
  })
  .superRefine(dateRangeRefine);

export const UpdateGroceryListSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    isArchived: z.boolean().optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate) {
      dateRangeRefine({ startDate: data.startDate, endDate: data.endDate }, ctx);
    }
  });

export const CreateGroceryItemSchema = z
  .object({
    ingredientId: uuid.optional(),
    displayText: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().min(0).max(9999.999).optional(),
    unit: z.string().trim().max(30).optional(),
    category,
  })
  .superRefine((data, ctx) => {
    if (!data.ingredientId && !data.displayText) {
      ctx.addIssue({ code: "custom", message: "ingredientId or displayText required" });
    }
  });

export const UpdateGroceryItemSchema = z.object({
  checked: z.boolean().optional(),
  displayText: z.string().trim().min(1).max(120).optional(),
  quantity: z.number().min(0).max(9999.999).nullable().optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  category: category.optional(),
});

export const CarryOverSchema = z.object({
  toListId: uuid,
});

export type CreateGroceryListInput = z.infer<typeof CreateGroceryListSchema>;
export type UpdateGroceryListInput = z.infer<typeof UpdateGroceryListSchema>;
export type CreateGroceryItemInput = z.infer<typeof CreateGroceryItemSchema>;
export type UpdateGroceryItemInput = z.infer<typeof UpdateGroceryItemSchema>;
export type CarryOverInput = z.infer<typeof CarryOverSchema>;
