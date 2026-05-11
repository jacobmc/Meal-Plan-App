# Data Access Convention

## Rule

Every database query against a domain table MUST be scoped by `family_id`.
There is no exception in v1.

## How to comply

In API routes:

```ts
import { apiHandler } from "@/lib/auth/api-handler";
import { withFamily } from "@/lib/auth/with-family";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const GET = apiHandler(async () => {
  const { familyId } = await withFamily();
  const items = await db
    .select()
    .from(profiles)
    .where(eq(profiles.familyId, familyId));
  return { items };
});
```

In Server Components:

```tsx
import { withFamily } from "@/lib/auth/with-family";
// same pattern: resolve familyId first, scope every query.
```

## Identity tables (exempt — they ARE the scoping mechanism)

- `users` — keyed by `clerk_user_id`
- `families` — keyed by `id`
- `family_users` — the join row used to derive `familyId`

Everything else is a domain table and MUST filter by `family_id`.

## Why no Postgres RLS in v1

Application-layer enforcement is simpler to read, audit, and test. RLS is a
non-breaking add later (set `app.current_family_id` per-request and apply
`USING` policies). When we add a second customer, we'll evaluate.

## Future enforcement options

- A custom Drizzle helper `scopedDb(familyId)` that pre-applies the filter.
- An ESLint rule that flags raw `db.select().from(<domain table>)` calls
  without a `.where(eq(<domain table>.familyId, ...))`.

Both deferred to a later phase.
