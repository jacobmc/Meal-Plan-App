import Link from "next/link";
import { Card } from "@/components/ui/card";

export interface MealSummary {
  id: string;
  name: string;
  tags: string[];
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
}

export function MealListItem({ meal }: { meal: MealSummary }) {
  const total =
    (meal.prepTimeMinutes ?? 0) + (meal.cookTimeMinutes ?? 0) || null;
  return (
    <li>
      <Link href={`/app/meals/${meal.id}`} className="block">
        <Card className="flex flex-row items-start gap-3 p-3">
          <div className="flex flex-1 flex-col gap-1">
            <div className="font-medium">{meal.name}</div>
            <div className="text-xs text-muted-foreground">
              {total ? `${total} min` : "—"}
              {meal.servings ? ` · ${meal.servings} servings` : ""}
            </div>
            {meal.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
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
        </Card>
      </Link>
    </li>
  );
}
