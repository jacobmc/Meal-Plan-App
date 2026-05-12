import { and, asc, eq } from "drizzle-orm";
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { NotFoundError } from "@/lib/auth/errors";
import { db } from "@/lib/db/client";
import { meals, mealIngredients, ingredients } from "@/lib/db/schema";

type RouteCtx = { params: Promise<{ id: string }> };

async function fetchMealDetail(mealId: string, familyId: string) {
  const [meal] = await db
    .select()
    .from(meals)
    .where(and(eq(meals.id, mealId), eq(meals.familyId, familyId)))
    .limit(1);
  if (!meal) return null;
  const ingRows = await db
    .select({
      id: mealIngredients.id,
      ingredientId: mealIngredients.ingredientId,
      displayText: mealIngredients.displayText,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      sortOrder: mealIngredients.sortOrder,
      ingredientName: ingredients.name,
    })
    .from(mealIngredients)
    .leftJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
    .where(eq(mealIngredients.mealId, mealId))
    .orderBy(asc(mealIngredients.sortOrder));
  return {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    instructions: meal.instructions,
    prepTimeMinutes: meal.prepTimeMinutes,
    cookTimeMinutes: meal.cookTimeMinutes,
    servings: meal.servings,
    sourceUrl: meal.sourceUrl,
    tags: meal.tags,
    updatedAt: meal.updatedAt,
    ingredients: ingRows,
  };
}

export const GET = apiHandler<RouteCtx>(async (_req, ctx) => {
  const { familyId } = await withFamily();
  const { id } = await ctx.params;
  const detail = await fetchMealDetail(id, familyId);
  if (!detail) throw new NotFoundError("Meal not found");
  return detail;
});
