import { formatWallDateTime, parseWallDateTime, resolveWallDateTime } from "../countdown/recurrence";
import type { WallDateTime } from "../countdown/recurrence";
import { countdownUnits } from "./units";
import type { CountdownUnit } from "./units";

export interface CountdownPart {
  unit: CountdownUnit;
  value: number;
}

const secondMs = 1_000;
const minuteMs = 60 * secondMs;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

const calendarUnits = ["decade", "year", "month", "week", "day"] as const;
type CalendarUnit = (typeof calendarUnits)[number];
type FixedUnit = Exclude<CountdownUnit, CalendarUnit>;

const isCalendarUnit = (unit: CountdownUnit): unit is CalendarUnit =>
  (calendarUnits as readonly string[]).includes(unit);

const fixedUnitMs: Record<FixedUnit, number> = { hour: hourMs, minute: minuteMs, second: secondMs };

/** Rough lengths used only to seed the whole-step search; exact counting happens on the calendar. */
const approximateUnitMs: Record<CalendarUnit, number> = {
  decade: 3652.5 * dayMs,
  year: 365.25 * dayMs,
  month: 30.4375 * dayMs,
  week: 7 * dayMs,
  day: dayMs,
};

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const addWallMonths = (wall: WallDateTime, months: number): WallDateTime => {
  const total = wall.year * 12 + (wall.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { ...wall, year, month, day: Math.min(wall.day, daysInMonth(year, month)) };
};

const addWallDays = (wall: WallDateTime, days: number): WallDateTime => {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days, wall.hour, wall.minute, wall.second));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
};

const addWallUnit = (wall: WallDateTime, unit: CalendarUnit, count: number): WallDateTime => {
  switch (unit) {
    case "decade":
      return addWallMonths(wall, count * 120);
    case "year":
      return addWallMonths(wall, count * 12);
    case "month":
      return addWallMonths(wall, count);
    case "week":
      return addWallDays(wall, count * 7);
    case "day":
      return addWallDays(wall, count);
  }
};

const naiveUtcInstant = (wall: WallDateTime) =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

const utcWall = (instant: Date): WallDateTime => ({
  year: instant.getUTCFullYear(),
  month: instant.getUTCMonth() + 1,
  day: instant.getUTCDate(),
  hour: instant.getUTCHours(),
  minute: instant.getUTCMinutes(),
  second: instant.getUTCSeconds(),
});

/** Wall-clock view of an instant in the zone; falls back to UTC when the zone is unsupported. */
const toWall = (instant: Date, timeZone: string): WallDateTime =>
  parseWallDateTime(formatWallDateTime(instant, timeZone)) ?? utcWall(instant);

/** Instant for a wall value in the zone; falls back to the naive UTC reading when unresolvable. */
const toInstantMs = (wall: WallDateTime, timeZone: string) =>
  resolveWallDateTime(wall, timeZone)?.getTime() ?? naiveUtcInstant(wall);

/** Instant of `count` steps past the cursor; step 0 is the cursor's own exact instant. */
const makeInstantOf =
  (cursor: WallDateTime, cursorMs: number, unit: CalendarUnit, timeZone: string, subSecondMs: number) =>
  (count: number) =>
    count === 0 ? cursorMs : toInstantMs(addWallUnit(cursor, unit, count), timeZone) + subSecondMs;

const countWholeSteps = (instantOf: (count: number) => number, unit: CalendarUnit, targetMs: number) => {
  let count = Math.max(0, Math.floor((targetMs - instantOf(0)) / approximateUnitMs[unit]));
  while (count > 0 && instantOf(count) > targetMs) count -= 1;
  while (instantOf(count + 1) <= targetMs) count += 1;
  return count;
};

/**
 * Splits `to - from` into the selected units, descending. Calendar units (decade, year, month,
 * week, day) step on the event zone's wall clock; hour, minute and second use the remaining
 * milliseconds. Time covered by an unselected unit flows into the next lower selected unit.
 */
export const getCountdownBreakdown = (
  from: Date,
  to: Date,
  units: readonly CountdownUnit[],
  timeZone: string,
): CountdownPart[] => {
  const ordered = countdownUnits.filter((unit) => units.includes(unit));
  const targetMs = to.getTime();
  if (targetMs <= from.getTime()) return ordered.map((unit) => ({ unit, value: 0 }));

  const parts: CountdownPart[] = [];
  let cursor = toWall(from, timeZone);
  // Wall values have whole seconds; carry the sub-second part of `from` so it is never lost.
  const subSecondMs = from.getMilliseconds();
  // The cursor's exact instant is tracked separately: in the repeated fall-back hour a wall value
  // is ambiguous and would resolve to the first pass, skewing every probe by an hour.
  let cursorMs = from.getTime();

  for (const unit of ordered) {
    if (!isCalendarUnit(unit)) continue;
    const instantOf = makeInstantOf(cursor, cursorMs, unit, timeZone, subSecondMs);
    const value = countWholeSteps(instantOf, unit, targetMs);
    parts.push({ unit, value });
    if (value > 0) {
      cursor = addWallUnit(cursor, unit, value);
      cursorMs = instantOf(value);
    }
  }

  let remainingMs = targetMs - cursorMs;
  for (const unit of ordered) {
    if (isCalendarUnit(unit)) continue;
    const unitMs = fixedUnitMs[unit];
    const value = Math.max(0, Math.floor(remainingMs / unitMs));
    parts.push({ unit, value });
    remainingMs -= value * unitMs;
  }

  return parts;
};

/** Hides zero-valued parts before the first non-zero part; the last part is always kept. */
export const trimLeadingZeroParts = (parts: CountdownPart[]): CountdownPart[] => {
  const firstNonZero = parts.findIndex((part) => part.value > 0);
  if (firstNonZero === -1) return parts.slice(-1);
  return parts.slice(firstNonZero);
};
