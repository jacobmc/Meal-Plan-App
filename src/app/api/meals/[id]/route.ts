import { and, eq, inArray } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError, ValidationError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { meals, mealIngredients, ingredients } from "@/lib/db/schema";
import { MealUpdateSchema } from "@/lib/validation/meal";
import { fetchMealDetail } from "../_meal-detail";

type RouteCtx = { params: Promise<{ id: string }> };

export const GET = apiHandler<RouteCtx>(async (_req, ctx) => {
  const { familyId } = await withFamily();
  const { id } = await ctx.params;
  const detail = await fetchMealDetail(id, familyId);
  if (!detail) throw new NotFoundError("Meal not found");
  return detail;
});

export const PATCH = apiHandler<RouteCtx>(async (req, ctx) => {
  const { familyId, userId } = await withFamily();
  const { id } = await ctx.params;

  // Verify the meal exists and belongs to this family before mutating
  const [existing] = await db
    .select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.id, id), eq(meals.familyId, familyId)))
    .limit(1);
  if (!existing) throw new NotFoundError("Meal not found");

  const json = await req.json();
  const parsed = MealUpdateSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Invalid meal payload", parsed.error.flatten());
  }

  // Validate referenced ingredient IDs belong to the family
  const newIngredientIds = (parsed.data.ingredients ?? [])
    .map((r) => r.ingredientId)
    .filter((v): v is string => Boolean(v));
  if (newIngredientIds.length > 0) {
    const owned = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.familyId, familyId), inArray(ingredients.id, newIngredientIds)));
    if (owned.length !== new Set(newIngredientIds).size) {
      throw new ValidationError("One or more ingredient IDs are invalid");
    }
  }

  await db.transaction(async (tx) => {
    const updates: Record<string, unknown> = {
      updatedByUserId: userId,
      updatedAt: new Date(),
    };
    for (const k of [
      "name",
      "description",
      "instructions",
      "prepTimeMinutes",
      "cookTimeMinutes",
      "servings",
      "sourceUrl",
      "tags",
    ] as const) {
      if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
    }
    await tx.update(meals).set(updates).where(eq(meals.id, id));

    if (parsed.data.ingredients !== undefined) {
      await tx.delete(mealIngredients).where(eq(mealIngredients.mealId, id));
      if (parsed.data.ingredients.length > 0) {
        await tx.insert(mealIngredients).values(
          parsed.data.ingredients.map((r) => ({
            mealId: id,
            ingredientId: r.ingredientId ?? null,
            displayText: r.displayText ?? null,
            quantity: r.quantity != null ? String(r.quantity) : null,
            unit: r.unit ?? null,
            sortOrder: r.sortOrder,
          })),
        );
      }
    }
  });

  const detail = await fetchMealDetail(id, familyId);
  if (!detail) throw new NotFoundError("Meal not found after update"); // shouldn't happen
  return detail;
});

export const DELETE = apiHandler<RouteCtx>(async (_req, ctx) => {
  const { familyId } = await withFamily();
  const { id } = await ctx.params;
  const result = await db
    .delete(meals)
    .where(and(eq(meals.id, id), eq(meals.familyId, familyId)))
    .returning({ id: meals.id });
  if (result.length === 0) throw new NotFoundError("Meal not found");
  return undefined; // 204 via apiHandler
});
