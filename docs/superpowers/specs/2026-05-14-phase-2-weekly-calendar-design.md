# Phase 2 — Weekly Calendar + Overrides: Design

**Status:** Draft for review
**Date:** 2026-05-14
**Scope:** Second product slice on top of Phase 1's recipe library. Adds the weekly meal calendar, per-profile overrides, and the eat-out flag. Sequential predecessor to Phase 3 (grocery list), which reads from the schedule built here.

---

## 1. Summary

A family can plan a week's meals across four slots per day (breakfast / lunch / dinner / snack), with a single shared default plan plus optional per-profile overrides for slots where one person eats differently. Any slot can instead be marked as "eating out" with an optional cost and label. A toggle switches the page between the family default view and any individual profile's resolved view.

Drag-to-reschedule, "carry leftovers forward," and any analytics dashboard are explicit deferrals.

## 2. Exit criteria

A seeded family can:

- Plan every slot of a week from their existing meal library.
- Override any slot for a specific profile.
- See override badges on the default view wherever overrides exist.
- Toggle the page between the family default and any profile's resolved view; the selection survives reload and is shareable via URL.
- Mark any slot as eating out with cost + optional label, mutually exclusive with a meal assignment.
- Add a free-text note to any slot.
- Copy the prior week's default plan into the current week with one action.
- Navigate weeks via prev / next / today; deep-link to a specific week.

Mobile smoke pass on iOS Safari and Android Chrome covers each of the above.

## 3. Scope decisions

### In scope

- `schedule_entries` table with the schema locked in the overview spec, plus the two partial unique indexes.
- Pure resolution function `resolveWeek(familyId, weekStart, profileId?)` returning a dense 7×4 grid.
- REST API under `/api/schedule/*`.
- `/app/calendar` route — responsive: agenda-stacked on mobile, 7-column grid on desktop.
- Slot picker modal with three modes: **Pick meal**, **Eating out**, **Clear**.
- Per-slot inline notes.
- Override badges on the default view (small dot when any override exists for the slot).
- Profile view toggle (`?profile=<id>` or `?profile=default`).
- Week navigation (`?week=YYYY-MM-DD`) with prev / next / today.
- "Copy last week" action — copies the prior week's default rows only, never overrides.
- Empty states: "No meals yet — build a recipe first" links to `/app/meals/new`.

### Out of scope (deferred)

- Drag-to-reschedule. Tap-to-move (cut/paste) is sufficient for v1.
- Bulk operations beyond "copy last week" (no multi-select, no "duplicate this week to next 4 weeks").
- Per-profile copy-last-week (only default-plan rows are copied).
- Splitting a whole-family eat-out cost across profiles. The dashboard (Phase 4) handles this as its own category.
- Recurring meal templates ("pasta every Tuesday").
- Slot reordering or custom slot names — the four-value enum is final for v1.
- Calendar export (iCal, Google Calendar). PDF export ships in Phase 6.
- Multi-day planning views (3-day, monthly). The PDF export in Phase 6 renders those formats; in-app this phase is week-only.

## 4. Data model

One new table, matching the overview spec §5 verbatim.

```sql
CREATE TYPE meal_slot AS ENUM ('breakfast','lunch','dinner','snack');

CREATE TABLE schedule_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id             uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  date                  date NOT NULL,
  slot                  meal_slot NOT NULL,
  profile_id            uuid REFERENCES profiles(id) ON DELETE CASCADE,
  meal_id               uuid REFERENCES meals(id) ON DELETE SET NULL,
  eating_out            boolean NOT NULL DEFAULT false,
  eating_out_cost       numeric(10,2),
  eating_out_label      text,
  notes                 text,
  created_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_entries_meal_xor_eatout
    CHECK (NOT (meal_id IS NOT NULL AND eating_out = true)),
  CONSTRAINT schedule_entries_eatout_cost_when_eatout
    CHECK (eating_out = true OR (eating_out_cost IS NULL AND eating_out_label IS NULL))
);

-- Default rows: at most one per (family, date, slot)
CREATE UNIQUE INDEX schedule_entries_default_uniq
  ON schedule_entries (family_id, date, slot)
  WHERE profile_id IS NULL;

-- Override rows: at most one per (family, date, slot, profile)
CREATE UNIQUE INDEX schedule_entries_override_uniq
  ON schedule_entries (family_id, date, slot, profile_id)
  WHERE profile_id IS NOT NULL;

-- Read path for a week
CREATE INDEX schedule_entries_family_date_idx
  ON schedule_entries (family_id, date);
```

**Why two partial unique indexes:** Postgres treats `NULL`s as distinct in a regular `UNIQUE` constraint, so a single `UNIQUE (family_id, date, slot, profile_id)` would allow many default rows for the same `(family, date, slot)`. The partial indexes split the rule cleanly: exactly one default, exactly one override per profile.

**Why `meal_id ON DELETE SET NULL`:** deleting a meal that's still scheduled should not cascade-destroy the schedule entry. The slot becomes "empty" and surfaces in the UI as needing reassignment. Matches the audit-column pattern established in Phase 1.5. The UI renders an orphaned-meal slot as `{ kind: 'empty' }` from the resolver's perspective; cleanup happens on next edit.

**Why `profile_id ON DELETE CASCADE`:** if a profile is hard-deleted (no soft-delete in v1), their overrides should disappear with them — the default plan is unaffected.

**The "empty slot" question:** an empty slot is the absence of a row, not a row with `meal_id IS NULL AND eating_out = false`. Clearing a slot is `DELETE`. This keeps the table sparse and makes "copy last week" trivial.

**Notes on cleared default with active overrides:** if the user clears the family default for a slot, override rows remain unless explicitly cleared. The override is the resolved meal for that profile; other profiles see "empty." This is a feature, not a bug — it lets you say "everyone fends for themselves except Sam."

**Drizzle implementation:** add `mealSlotEnum`, `scheduleEntries` to `src/lib/db/schema.ts`. One migration file via `pnpm db:generate`.

## 5. Resolution function

The single source of truth for "what is everyone eating this week."

```ts
// src/lib/schedule/resolve.ts

export type ResolvedSlot =
  | { kind: 'empty' }
  | { kind: 'meal'; entry: ScheduleEntry; meal: MealSummary; source: 'default' | 'override' }
  | { kind: 'eat-out'; entry: ScheduleEntry; source: 'default' | 'override' };

export type ResolvedDay = Record<MealSlot, ResolvedSlot>;
export type ResolvedWeek = {
  weekStart: string;           // ISO date, family-week-start aligned
  days: ResolvedDay[];         // length 7, Mon→Sun or Sun→Sat per family setting
  overrideMap: Record<string, MealSlot[]>; // date → slots that have any override row
};

export async function resolveWeek(
  familyId: string,
  weekStart: Date,
  profileId: string | null,    // null = family default view
): Promise<ResolvedWeek>;
```

**Logic per slot:**

```
if profileId is not null:
  override = entry WHERE date=D AND slot=S AND profile_id = profileId
  if override exists: return override (source='override')
default = entry WHERE date=D AND slot=S AND profile_id IS NULL
if default exists: return default (source='default')
return empty
```

**Query strategy:** one round-trip per week. `SELECT * FROM schedule_entries WHERE family_id = $1 AND date BETWEEN $2 AND $3` joined to `meals` for name/tags, then bucketed in TypeScript. The `overrideMap` is built from the same result set in the same pass.

**Tested in isolation** with synthetic rows — this is the highest-value unit test target of the phase.

## 6. API surface

All routes follow the established conventions: `apiHandler` wrapper, `withFamily` for tenant scoping, Zod validation, JSON error envelope. Mutations return the resolved state for the affected slot so the client can patch in place.

```
GET    /api/schedule/week?week=YYYY-MM-DD&profile=<id|default>
                                              → ResolvedWeek

POST   /api/schedule/entries                  → { entry, resolvedSlot }
PATCH  /api/schedule/entries/[id]             → { entry, resolvedSlot }
DELETE /api/schedule/entries/[id]             → { resolvedSlot }   // 200 not 204; body carries the new slot state

POST   /api/schedule/copy-week                → { copied: number, week: ResolvedWeek }
```

### Query params

- `GET /api/schedule/week`: `week` is required (any ISO date; server normalizes to the family's week start). `profile` is optional, defaulting to family default. If `profile=<id>` is provided, the response's `days[].slot` uses the override-or-default resolution; otherwise it returns the default plan with `overrideMap` populated.

### Shapes

```ts
type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

type ScheduleEntry = {
  id: string;
  date: string;                    // YYYY-MM-DD
  slot: MealSlot;
  profileId: string | null;
  mealId: string | null;
  eatingOut: boolean;
  eatingOutCost: number | null;    // dollars, 2dp
  eatingOutLabel: string | null;
  notes: string | null;
  updatedAt: string;
};

type ResolvedSlot =
  | { kind: 'empty' }
  | { kind: 'meal'; entry: ScheduleEntry; meal: { id: string; name: string; tags: string[] }; source: 'default'|'override' }
  | { kind: 'eat-out'; entry: ScheduleEntry; source: 'default'|'override' };
```

### Mutation semantics

- **POST `/api/schedule/entries`**: creates a default row (`profileId` omitted) or an override (`profileId` set). 409 if a row already exists for the same `(family, date, slot, profile_id-or-null)` — clients should `PATCH` instead. Body must specify either `mealId` xor `eatingOut: true`; never both.
- **PATCH `/api/schedule/entries/[id]`**: in-place update. Permitted transitions: meal ↔ meal, meal ↔ eat-out, eat-out ↔ eat-out, any → notes-only. Setting `mealId` clears eat-out fields atomically; setting `eatingOut: true` clears `mealId` atomically. Validation lives in the Zod refinement, not in code branches.
- **DELETE `/api/schedule/entries/[id]`**: hard-deletes the row. Response includes the now-resolved slot state for the same `(date, slot, profileId)` — deleting an override returns the default's state; deleting a default returns `{ kind: 'empty' }`.
- **POST `/api/schedule/copy-week`**: body `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }`. Single SQL transaction: `INSERT INTO schedule_entries (...) SELECT ... FROM schedule_entries WHERE family_id=? AND date BETWEEN from AND from+6 AND profile_id IS NULL` with date-shifted, fresh ids and refreshed audit columns. Skips rows that would collide with the partial unique index — i.e. the target week's existing default rows are preserved, not overwritten. Returns the resolved target week so the page can re-render.

### Zod schemas

Live under `src/lib/validation/schedule.ts`. Inferred types are exported for client reuse.

## 7. Routing + pages

```
/app/calendar                      RSC, week view
/app/calendar?week=YYYY-MM-DD      RSC, specific week
/app/calendar?week=...&profile=ID  RSC, specific profile's resolved view
```

Single route. The page reads `searchParams`, calls `resolveWeek` server-side (no HTTP round-trip), and renders. Mutations from client islands push URL changes via `router.replace()` when navigation is involved; slot edits happen via fetch with no URL change.

`/app/meals` gets a "Plan a week →" link in its header pointing at `/app/calendar`. `/app/calendar` shows an empty-library state ("Build a recipe to start planning") when the family has zero meals.

### Sign-in redirect

In scope: change the post-sign-in landing route from `/app/meals` to `/app/calendar`. Rationale: the calendar is the daily-use surface; the meals library is the build-out surface. One-line change in the Clerk redirect config. If a family has zero meals the calendar's empty state routes them to `/app/meals/new`, so no one is stranded.

## 8. UI components

New components under `src/components/calendar/`:

| Component | Purpose |
|---|---|
| `week-view.tsx` | RSC: container that renders the responsive layout. Picks `<day-agenda>` rows on mobile, `<week-grid>` on `md+`. |
| `week-grid.tsx` | Desktop 7×4 grid. Pure render over a `ResolvedWeek`. |
| `day-agenda.tsx` | Mobile vertical list: one card per day with the four slots stacked. |
| `slot-cell.tsx` | A single slot's render: meal name, eat-out badge, override dot, notes glyph, tap target. |
| `slot-editor.tsx` | Client island: bottom-sheet (mobile) / modal (desktop) with the three modes: pick-meal, eating-out, clear. |
| `meal-picker.tsx` | Reuses the `/api/meals` endpoint with the prefix-search input pattern from Phase 1. Returns a `mealId`. |
| `eat-out-form.tsx` | Inline form: optional cost (numeric, 2dp) + optional label (≤80 chars). |
| `profile-toggle.tsx` | Header control: `Family default ▾` opening to the family's active profiles. Updates `?profile=` via `router.replace()`. |
| `week-nav.tsx` | Prev / next / today buttons + the printed week range. URL-driven. |
| `copy-week-button.tsx` | Confirm dialog ("Copy last week's plan into this week?"), calls `/api/schedule/copy-week`. |
| `notes-input.tsx` | Inline single-line input on the slot editor for the `notes` field. |

### Responsive breakpoint

Tailwind `md` (768 px). Below: agenda. At or above: grid. No JS branching — both layouts render server-side, hidden via Tailwind's `md:hidden` / `hidden md:block`.

### Override-badge rendering

On the default view, `slot-cell` shows a small dot (e.g. `•` colored from the profile color) when `overrideMap[date]?.includes(slot)`. On hover/long-press, a tooltip lists the overriding profiles. On a per-profile view, override-sourced slots show the source label inline (`Sam's pick`).

### Empty states

- **No meals in library:** centered card on `/app/calendar`, "You need recipes before you can plan. Build your first one →" linking to `/app/meals/new`. Cleared once the family has any non-archived meal.
- **Empty week:** the week renders with all 28 slots empty; the "Copy last week →" button is prominent. If the prior week is also empty, the button is shown but disabled with a tooltip.

## 9. Validation + errors

### Zod limits

- `date`: ISO date string.
- `slot`: matches the enum.
- `profileId`: UUID, must be active and family-scoped (validated server-side, not in Zod).
- `mealId`: UUID, must be non-archived and family-scoped.
- `eatingOut`: boolean.
- `eatingOutCost`: 0–9999.99, 2dp, only allowed when `eatingOut = true`.
- `eatingOutLabel`: 1–80 chars, optional, only allowed when `eatingOut = true`.
- `notes`: 1–500 chars, optional.
- POST/PATCH bodies: Zod refinement enforces "exactly one of meal-mode or eat-out-mode."

### Error codes

Reuse the standard envelope. New code paths:

- `conflict` — POST attempted on an existing `(family, date, slot, profile_id-or-null)` row. Client should PATCH instead.
- `validation_failed` — meal/eat-out exclusivity, cost-without-eatout, etc.
- `not_found` — entry id missing or family mismatch.

## 10. Testing strategy

### Unit (Vitest)

- `resolveWeek`: empty family → all empty; default-only → all from default; per-profile with no overrides → identical to default; per-profile with overrides → overrides win; mixed slot-by-slot scenarios.
- `overrideMap` correctness: marks every slot that has at least one override row for that `(date, slot)`.
- `copyWeekPlan` SQL-builder (the date-shift logic): off-by-one across DST boundaries, week-start alignment.
- Zod refinements: meal-mode and eat-out-mode exclusivity, cost-requires-eatout.

### Integration (Vitest + DB)

- `POST /api/schedule/entries` writes a default row.
- `POST /api/schedule/entries` writes an override row.
- `POST` returns 409 on conflict with an existing same-scope row.
- `PATCH` swaps meal → eat-out and clears mealId atomically; reverse direction clears eat-out fields.
- `DELETE` of an override returns the default's resolved state.
- `DELETE` of a default with active overrides leaves the overrides in place.
- `GET /api/schedule/week` honors family week-start.
- `GET /api/schedule/week?profile=<id>` returns override-resolved slots.
- `POST /api/schedule/copy-week` copies default rows only, skips collisions, refreshes audit columns.
- Tenant scoping: family A cannot read or mutate any of family B's schedule entries.
- Cross-tenant FK: POST with a `profileId` belonging to another family returns `not_found` (not `validation_failed`).

### E2E (Playwright)

Extend `tests/e2e/smoke.spec.ts`:

1. Sign in.
2. Navigate to `/app/calendar`.
3. Pick a meal for Mon/dinner.
4. Override Mon/dinner for one profile.
5. Toggle to that profile's view; confirm the override resolves.
6. Mark Tue/lunch as eating out with a cost; confirm it renders.
7. Click "Copy last week" against an empty target week and confirm rows materialize.

## 11. Dependencies to add

None expected. `date-fns` is already installed (Phase 0). The grid layout uses Tailwind only. `react-hook-form` + `@hookform/resolvers` already present.

If timezone-aware date math gets hairy, `@date-fns/tz` may be added — flagged but not committed.

## 12. Migration order

One Drizzle migration file:

1. `CREATE TYPE meal_slot`.
2. `CREATE TABLE schedule_entries` with constraints.
3. `CREATE UNIQUE INDEX` for the two partials.
4. `CREATE INDEX schedule_entries_family_date_idx`.

Migration runs in CI and on every Vercel deploy via the existing `vercel-build` script.

## 13. Assumptions to revisit

- **Tap-to-move instead of drag-to-reschedule.** Revisit if users complain that moving meals across slots is too click-heavy.
- **`notes` is single-line, ≤500 chars.** Revisit if anyone wants markdown or longer free text in notes.
- **Copy-week copies defaults only.** Revisit if "copy with overrides" becomes a recurring request.
- **One row per slot.** No "two meals at one dinner" support; revisit when first user asks.
- **`families.timezone` is read for week alignment but not user-editable.** Phase 0 left this unaddressed; the calendar surfaces the assumption first. If misalignment shows up in QA, ship a settings field.
- **No optimistic UI on slot edits.** Slot edits await server response before re-rendering; latency budget is comfortable given the small payload. Revisit if perceived latency degrades the kitchen-counter use case.

## 14. Out of scope for this spec

- Pixel-level wireframes (will be drawn during implementation, validated against ASCII layouts in §1 of the brainstorm).
- Phase 3 grocery-list integration. The schedule is read-only from Phase 3's perspective; that contract is documented when Phase 3 lands.
- Phase 4 spend dashboard. It reads `eating_out=true` rows from this table; no schema change needed.
- PDF export views of the calendar (Phase 6).
