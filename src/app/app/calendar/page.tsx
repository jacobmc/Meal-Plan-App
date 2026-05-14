import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { families, profiles } from "@/lib/db/schema";
import { withFamily } from "@/lib/auth/with-family";
import { resolveWeek } from "@/lib/schedule/resolve";
import { parseISODate, weekStartFor, formatISODate } from "@/lib/schedule/week";
import { WeekNav } from "@/components/calendar/week-nav";
import { ProfileToggle } from "@/components/calendar/profile-toggle";
import { WeekView } from "@/components/calendar/week-view";
import { CopyWeekButton } from "@/components/calendar/copy-week-button";

type Search = { week?: string; profile?: string };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const { familyId } = await withFamily();

  const [family] = await db.select().from(families).where(eq(families.id, familyId));
  const weekStartsOn = family?.weekStartsOn ?? 0;

  const anyDay = sp.week ? parseISODate(sp.week) : new Date();
  const weekStart = weekStartFor(anyDay, weekStartsOn);
  const profileId = sp.profile && sp.profile !== "default" ? sp.profile : null;

  const week = await resolveWeek(familyId, weekStart, profileId);

  const activeProfiles = await db
    .select({ id: profiles.id, displayName: profiles.displayName, color: profiles.color })
    .from(profiles)
    .where(eq(profiles.familyId, familyId));

  const prev = new Date(weekStart);
  prev.setUTCDate(prev.getUTCDate() - 7);
  const next = new Date(weekStart);
  next.setUTCDate(next.getUTCDate() + 7);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Calendar</h1>
          <ProfileToggle
            profiles={activeProfiles}
            selectedProfileId={profileId}
          />
        </div>
        <div className="flex items-center gap-2">
          <CopyWeekButton fromWeekISO={formatISODate(prev)} toWeekISO={formatISODate(weekStart)} />
          <WeekNav
            prevISO={formatISODate(prev)}
            nextISO={formatISODate(next)}
            weekStartISO={formatISODate(weekStart)}
          />
        </div>
      </header>
      <WeekView week={week} profileColors={Object.fromEntries(activeProfiles.map((p) => [p.id, p.color]))} />
    </div>
  );
}
