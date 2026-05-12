import { MealForm } from "@/components/meal-form";

export default function NewMealPage() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">New recipe</h2>
      <MealForm />
    </div>
  );
}
