import Link from "next/link";
import { notFound } from "next/navigation";
import { withFamily } from "@/lib/auth/with-family";
import { fetchMealDetail } from "@/app/api/meals/_meal-detail";
import { buttonVariants } from "@/components/ui/button";
import { MarkdownView } from "@/components/markdown-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MealDetailPage({ params }: PageProps) {
  const { familyId } = await withFamily();
  const { id } = await params;
  const meal = await fetchMealDetail(id, familyId);
  if (!meal) notFound();

  const total =
    (meal.prepTimeMinutes ?? 0) + (meal.cookTimeMinutes ?? 0) || null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{meal.name}</h2>
          {meal.description ? (
            <p className="text-muted-foreground">{meal.description}</p>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {total ? <span>{total} min total</span> : null}
            {meal.servings ? <span>· {meal.servings} servings</span> : null}
            {meal.sourceUrl ? (
              <a
                href={meal.sourceUrl}
                target="_blank"
                rel="noopener"
                className="underline"
              >
                Source ↗
              </a>
            ) : null}
          </div>
          {meal.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {meal.tags.map((t) => (
                <span
                  key={t}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <Link
          href={`/app/meals/${meal.id}/edit`}
          className={buttonVariants({ variant: "outline" })}
        >
          Edit
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg font-medium">Ingredients</h3>
        {meal.ingredients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ingredients yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {meal.ingredients.map((i) => (
              <li key={i.id} className="text-sm">
                <span className="text-muted-foreground">
                  {i.quantity ? `${i.quantity} ` : ""}
                  {i.unit ? `${i.unit} ` : ""}
                </span>
                <span>
                  {i.ingredientName ?? i.displayText}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg font-medium">Instructions</h3>
        <MarkdownView source={meal.instructions} />
      </section>
    </div>
  );
}
