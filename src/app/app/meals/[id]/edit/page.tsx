import { notFound } from "next/navigation";
import { withFamily } from "@/lib/auth/with-family";
import { fetchMealDetail } from "@/app/api/meals/_meal-detail";
import { MealForm, type MealFormInitial } from "@/components/meal-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMealPage({ params }: PageProps) {
  const { familyId } = await withFamily();
  const { id } = await params;
  const meal = await fetchMealDetail(id, familyId);
  if (!meal) notFound();

  const initial: MealFormInitial = {
    id: meal.id,
    name: meal.name,
    description: meal.description,
    instructions: meal.instructions,
    prepTimeMinutes: meal.prepTimeMinutes,
    cookTimeMinutes: meal.cookTimeMinutes,
    servings: meal.servings,
    sourceUrl: meal.sourceUrl,
    tags: meal.tags,
    ingredients: meal.ingredients.map((i) => ({
      ingredientId: i.ingredientId,
      ingredientName: i.ingredientName,
      displayText: i.displayText,
      quantity: i.quantity,
      unit: i.unit,
      sortOrder: i.sortOrder,
    })),
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Edit recipe</h2>
      <MealForm initial={initial} />
    </div>
  );
}
