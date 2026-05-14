import { describe, it, expect } from "vitest";
import { weekStartFor, weekDates, formatISODate } from "@/lib/schedule/week";

describe("formatISODate", () => {
  it("formats Date to YYYY-MM-DD in UTC", () => {
    expect(formatISODate(new Date(Date.UTC(2026, 4, 14)))).toBe("2026-05-14");
  });
});

describe("weekStartFor", () => {
  it("returns the same date when given the week-start day", () => {
    // 2026-05-11 is a Monday
    const monday = new Date(Date.UTC(2026, 4, 11));
    expect(formatISODate(weekStartFor(monday, 1))).toBe("2026-05-11");
  });

  it("walks back to Monday when week starts on Monday", () => {
    // 2026-05-14 is a Thursday
    const thursday = new Date(Date.UTC(2026, 4, 14));
    expect(formatISODate(weekStartFor(thursday, 1))).toBe("2026-05-11");
  });

  it("walks back to Sunday when week starts on Sunday", () => {
    // 2026-05-14 is a Thursday
    const thursday = new Date(Date.UTC(2026, 4, 14));
    expect(formatISODate(weekStartFor(thursday, 0))).toBe("2026-05-10");
  });

  it("walks back from Sunday to previous Monday when week starts on Monday", () => {
    // 2026-05-10 is a Sunday
    const sunday = new Date(Date.UTC(2026, 4, 10));
    expect(formatISODate(weekStartFor(sunday, 1))).toBe("2026-05-04");
  });
});

describe("weekDates", () => {
  it("returns 7 dates starting from weekStart", () => {
    const start = new Date(Date.UTC(2026, 4, 11));
    const dates = weekDates(start);
    expect(dates).toHaveLength(7);
    expect(formatISODate(dates[0]!)).toBe("2026-05-11");
    expect(formatISODate(dates[6]!)).toBe("2026-05-17");
  });

  it("handles month boundaries", () => {
    const start = new Date(Date.UTC(2026, 4, 25));
    const dates = weekDates(start);
    expect(formatISODate(dates[6]!)).toBe("2026-05-31");
  });

  it("handles year boundaries", () => {
    const start = new Date(Date.UTC(2026, 11, 28));
    const dates = weekDates(start);
    expect(formatISODate(dates[6]!)).toBe("2027-01-03");
  });
});
