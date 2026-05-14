export function formatISODate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid ISO date: ${s}`);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Compute the start-of-week date for `d`, given the family's week-start day
 * (0 = Sunday, 1 = Monday, ..., 6 = Saturday). Result is normalized to UTC
 * midnight so downstream `DATE` comparisons are stable.
 */
export function weekStartFor(d: Date, weekStartsOn: number): Date {
  const day = d.getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
}

export function weekDates(weekStart: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    out.push(d);
  }
  return out;
}
