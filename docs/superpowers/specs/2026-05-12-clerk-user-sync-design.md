# Phase 1.5 — Clerk User Sync: Design

**Status:** Draft for review
**Date:** 2026-05-12
**Scope:** A signed-Svix Clerk webhook that keeps the `users` table in sync with Clerk's production user pool and bootstraps a family-of-one for brand-new sign-ups so they can immediately use the app.

---

## 1. Summary

The Phase 0 design called out Clerk webhooks as the forward-path for keeping identity mirrored without manual seed work. Phase 1 shipped the recipe library on top of a `users` table that's still populated only by the seed script. Phase 1.5 closes that gap: a new endpoint at `POST /api/clerk/webhooks` consumes `user.created` / `user.updated` / `user.deleted` events and writes to the local `users` table. On `user.created`, the handler also creates a single-person family and a default profile so the new user lands on a working `/app` page.

Invites, multi-user families, Clerk Orgs integration, and user-deletion → family-cascade cleanup are explicit deferrals.

## 2. Exit criteria

A brand-new sign-up at the Clerk-hosted UI:

1. Triggers `user.created` → row inserted in `users`, `families`, `family_users`, and `profiles`.
2. Lands on `/app` after sign-in with no errors.
3. Sees one profile already present at `/app/settings/profiles` (named after their Clerk display name or email-local-part).

Editing the user's email in the Clerk dashboard:

4. Triggers `user.updated` → `users.email` reflects the new value within seconds.

Deleting the user in the Clerk dashboard:

5. Triggers `user.deleted` → `users` row removed; their `family_users` row cascades away; their family + recipes + profiles persist (orphaned but recoverable).

Re-delivery of the same Svix event:

6. Is idempotent — no duplicate rows in any table.

## 3. Endpoint

```
POST /api/clerk/webhooks
```

- Public in `src/proxy.ts` (alongside `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/monitoring(.*)`).
- Verifies Svix signature using Clerk's official helper (`verifyWebhook` from `@clerk/nextjs/webhooks`), which reads `CLERK_WEBHOOK_SECRET` automatically.
- Response codes:
  - `200` — event processed (or intentionally ignored).
  - `400` — signature verification failure. Svix will not retry.
  - `5xx` — transient error (DB unavailable, etc.). Svix will retry with exponential backoff.

## 4. Events handled

| Event | Effect |
|---|---|
| `user.created` | Insert `users` row keyed on `clerkUserId`. If the row didn't already exist, also bootstrap the family (see §5). |
| `user.updated` | Update `email` and `display_name` on the existing row. If no row matches the `clerkUserId`, log a warning and return 200 (defensive — should not normally happen). |
| `user.deleted` | Delete the row by `clerkUserId`. Idempotent (no-op on already-deleted). The family it belonged to is intentionally left behind. |

All other Clerk events return 200 with no action.

## 5. `user.created` data flow

```
verify svix signature                                       (400 on failure)
parse event payload → {
  id,                                                       Clerk user id
  email_addresses[0].email_address,
  first_name, last_name,
  image_url                                                 (unused in this phase)
}

display_name = computeDisplayName(first_name, last_name, email)

db.transaction:
  inserted = INSERT INTO users (clerk_user_id, email, display_name)
             VALUES (id, email, display_name)
             ON CONFLICT (clerk_user_id) DO NOTHING
             RETURNING id

  if inserted is null: return 200            (idempotent short-circuit)

  family = INSERT INTO families (name)
           VALUES (display_name || "'s Family")
           RETURNING id

  INSERT INTO family_users (family_id, user_id)
    VALUES (family.id, inserted.id)

  INSERT INTO profiles (family_id, display_name, color, user_id,
                        created_by_user_id, updated_by_user_id)
    VALUES (family.id, display_name, '#94a3b8',
            inserted.id, inserted.id, inserted.id)

return 200
```

`computeDisplayName(first, last, email)`:

- If both `first` and `last` are non-empty: `"{first} {last}"`
- Else if only `first` is non-empty: `first`
- Else: email-local-part (everything before the `@`)
- Trim; clamp to ≤80 chars (matches `users.display_name` and `profiles.display_name` upper bound)

## 6. `user.updated` / `user.deleted` data flow

`user.updated`:

```
verify svix signature
parse → { id, email_addresses[0].email_address, first_name, last_name }
display_name = computeDisplayName(...)

UPDATE users
   SET email = $email, display_name = $display_name, updated_at = now()
 WHERE clerk_user_id = $id
RETURNING id

if no row returned: log warning (id), return 200
return 200
```

`user.deleted`:

```
verify svix signature
parse → { id }

DELETE FROM users WHERE clerk_user_id = $id
return 200
```

Cascade behavior on `DELETE FROM users`:
- `family_users.user_id` has `ON DELETE CASCADE` → row vanishes.
- `profiles.user_id` has `ON DELETE SET NULL` → profile detached from user but preserved.
- `meals.created_by_user_id` / `meals.updated_by_user_id` have implicit `NO ACTION` — the FK constraint *will block* the delete if the user authored or last-updated any meal.

**Implication:** if the user has authored any meals, the DELETE will fail and Svix will retry forever.

Pragmatic resolution for Phase 1.5: switch those two FKs to `ON DELETE SET NULL` in a small follow-up migration as part of this phase. Audit columns become null on user deletion, which is acceptable — we're keeping the data, just losing the authorship pointer.

## 7. Idempotency

Svix delivers each event at-least-once. The handler must be safe to run repeatedly:

- `users` insert: `ON CONFLICT (clerk_user_id) DO NOTHING`. Second delivery returns no row → handler short-circuits before touching any other table.
- `user.updated`: idempotent by construction (overwrites with the same source-of-truth values).
- `user.deleted`: idempotent (`DELETE` on missing row is a no-op).

## 8. Security

- **Signature verification:** mandatory. Without `CLERK_WEBHOOK_SECRET` set, the handler refuses to process events. The verification helper reads the secret from env, so a missing secret surfaces as a clear runtime error rather than silent acceptance.
- **Route exposure:** `/api/clerk/webhooks` is whitelisted in `src/proxy.ts` so Clerk's POST is not redirected to sign-in. The proxy matcher's pattern means we add `/api/clerk/webhooks` to the `isPublicRoute` list.
- **No CORS concerns:** Clerk's edge POSTs the webhook server-to-server.
- **Env validation:** `CLERK_WEBHOOK_SECRET` remains optional in `src/env.ts` so local dev / test boots don't require it. The webhook handler itself enforces presence.

## 9. Testing strategy

### Unit (Vitest)

`computeDisplayName` covering all branches:
- Both first + last → "First Last"
- First only → "First"
- Last only without first → email-local-part
- Neither → email-local-part
- Whitespace trimmed
- Long names truncated to 80 chars

### Integration (Vitest + DB)

All tests mock `verifyWebhook` (success or failure) and assert on DB state plus response.

- `user.created` happy path: one POST → rows present in all four tables.
- `user.created` idempotency: same payload twice → counts unchanged after second call.
- `user.created` with existing `users` row (e.g. seeded from the bootstrap UPDATE) → no duplicate insert; no new family created.
- `user.updated` updates email + display_name on the matching row.
- `user.updated` with unknown `clerk_user_id` → 200, warning logged, no DB change.
- `user.deleted` removes the user, cascades `family_users` membership, sets `profiles.user_id` null, leaves the family + recipes intact.
- Bad signature → 400, no DB writes.
- Unknown event type → 200, no DB writes.

## 10. Operational

### Clerk dashboard configuration

After deploy, in the Clerk **production** instance dashboard:
1. Webhooks → Add endpoint.
2. URL: `https://meal-plan.jacobmckinney.com/api/clerk/webhooks` (replace if domain changes).
3. Subscribe to: `user.created`, `user.updated`, `user.deleted`.
4. Copy the Signing Secret.
5. Add to Vercel env vars (Production + Preview): `CLERK_WEBHOOK_SECRET=<secret>`.
6. Redeploy or push to pick up the env change.

### Cutover for the existing single user

The user's old `users` row points at a dev-instance Clerk user id. The new production Clerk identity has a different id. The webhook will not retroactively fix this — it only runs on future Clerk events. Cutover steps:

1. Before deploying the webhook: log into Clerk's production dashboard, find your user's id (`user_xxxxxxxxxxxxxxxxxxxxxx`).
2. Run a one-row UPDATE against Neon prod via `psql` or Drizzle Studio:
   ```sql
   UPDATE users
      SET clerk_user_id = '<new_prod_clerk_user_id>'
    WHERE clerk_user_id = '<old_dev_clerk_user_id>';
   ```
3. Confirm `/app` loads.
4. Then ship the webhook normally — all future signups go through it; your account is already correct.

### Logging & observability

- Each handled event logs structured JSON with `event_id`, `event_type`, and the resolved Clerk user id.
- Unhandled exceptions are caught by the existing `apiHandler` wrapper and reported to Sentry with the event id in tags.
- A counter could be added later but is not part of v1.

## 11. Audit-FK migration (required follow-up within this phase)

`meals.created_by_user_id` and `meals.updated_by_user_id` currently have no explicit `onDelete` behavior in `src/lib/db/schema.ts`, so Postgres defaults to `NO ACTION`. With this default, `user.deleted` would fail for any user who authored a meal. Change both to `ON DELETE SET NULL` in a single Drizzle migration shipped as the first task of this phase.

Same audit columns exist on `profiles` (`created_by_user_id`, `updated_by_user_id`) — set those to `SET NULL` too while we're at it, for consistency.

## 12. Out of scope

- Clerk Orgs (`organization.*`, `organizationMembership.*` events) — future phase
- Family invites / join-existing-family flow — future phase
- User-deletion → family cascade-cleanup tool — future admin script
- Email verification re-prompt UX — handled by Clerk's hosted UI
- Profile photo sync from `image_url` — future polish
- Backfilling existing users from Clerk's user list — manual UPDATEs only

## 13. Assumptions to revisit

- **Single-person family on first sign-up.** Works for solo accounts. Multi-user-family flows will need an invite / join model.
- **`user.deleted` preserves family + data.** Cleaner than cascading; if it causes accounting confusion later, swap to cascade-on-sole-member.
- **`computeDisplayName` falls back to email-local-part.** Some users may dislike seeing this; can later prompt for display name during onboarding.
- **`ON DELETE SET NULL` for audit FKs.** Loses the authorship pointer when a user is deleted. If audit-trail completeness becomes a requirement, swap to `RESTRICT` plus a manual reassign step.
