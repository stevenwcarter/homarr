# Countdown Display Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `countdownDisplay` widget to this Homarr fork: big segmented countdown tiles with selectable units (decade…second, calendar-accurate rollup), bundled fonts incl. a seven-segment face, glow, auto-fit size with a scale slider; then build the image and point the k8s deployment at it.

**Architecture:** A new widget directory `packages/widgets/src/countdown-display/` that reuses the stock widget's recurrence module and event-list option. Pure duration math (`duration.ts`) and presentational tiles (`tiles.tsx`) are separate, tested modules; `component.tsx` wires them to `useWidgetNow`. Registration touches a fixed, documented set of upstream files so the branch rebases cleanly on new Homarr releases (see `FORK.md`, written in Task 6).

**Tech Stack:** TypeScript, React 19, Mantine 9, Next.js app router, dayjs (via the stock `recurrence.ts`), zod v4 (`zod/v4`), vitest + jsdom, oxlint/oxfmt, bun workspaces with a root dependency catalog, Docker buildx, Helm values in `~/k8s-config`.

**Spec:** `docs/superpowers/specs/2026-10-12-countdown-display-design.md`

## Global Constraints

- Widget kind string is exactly `countdownDisplay`; docs slug `countdown-display`; display name "Countdown display".
- The stock `countdown` widget is not modified. Shared code is imported from `../countdown/recurrence`, never copied.
- Only the files in the spec's "Touchpoints" table may be edited outside `packages/widgets/src/countdown-display/`, `FORK.md`, the top of `README.md`, and `docs/superpowers/**`.
- Dependencies: `@fontsource-variable/jetbrains-mono`, `@fontsource-variable/space-grotesk`, `@fontsource/orbitron`, `@fontsource/bebas-neue`, `@fontsource/dseg7-classic`, all `5.3.0`, declared as `"catalog:"` in `packages/widgets/package.json` with the version in the root `package.json` `workspaces.catalog`. No other new dependencies.
- No network fetches at build or run time for fonts (fontsource self-hosts woff2).
- Defaults: units `["day","hour","minute"]`, font `default`, scale `100` (50–200, step 5), glow `false`, showProgress `true`.
- Lint with `oxlint`, format with `oxfmt` (not ESLint/Prettier). UI is Mantine, icons `@tabler/icons-react`.
- Commit messages: conventional commits (`feat(widgets): …`, `docs: …`), each ending with the line `Claude-Session: https://claude.ai/code/session_01WGNUBWcdTtxMKubYqH5v79`. Commit with `git -c commit.gpgsign=false commit` if signing is not configured.
- Work on branch `countdown-display` in `/home/steve/src/homarr-widget-countdowns`. Never push to `upstream`.
- Image: `192.168.42.134:5000/homarr:v2.4.1-countdown.1`, `linux/amd64`. The `~/k8s-config` change is committed locally only, never pushed (ArgoCD auto-syncs on push).

## Review Focus

1. `now` with non-zero milliseconds must not inflate the seconds tile (e.g. 09:00:00.500 → 09:00:05.000 is 4 s, not 5). Pinned in Task 1 (`keeps sub-second precision`).
2. An event whose zone is far from UTC (Asia/Tokyo) must step months on the event's local calendar, not the UTC date. Pinned in Task 1 (`steps months on the event zone's calendar`).
3. A stored `units` array containing unknown strings or duplicates (older saves, hand-edited exports) must normalize to a valid, ordered, non-empty list. Pinned in Task 1 (`normalizeCountdownUnits`).
4. A stored `font` key that no longer exists must fall back to `default` instead of crashing the tile. Pinned in Task 2 (`getCountdownFont falls back`).
5. Decades-long countdown with only `second` selected must produce the plain floor of the total seconds (no overflow, no padding beyond width). Pinned in Task 1 (`rolls everything into seconds`).

---

### Task 1: Units and calendar-aware duration breakdown

**Files:**
- Create: `packages/widgets/src/countdown-display/units.ts`
- Create: `packages/widgets/src/countdown-display/duration.ts`
- Test: `packages/widgets/src/countdown-display/duration.spec.ts`

**Interfaces:**
- Consumes: `formatWallDateTime(instant: Date, timeZone: string): string`, `parseWallDateTime(value: string): WallDateTime | null`, `resolveWallDateTime(value: WallDateTime, timeZone: string): Date | null`, `WallDateTime { year, month (1-12), day, hour, minute, second }` from `../countdown/recurrence`.
- Produces:
  - `countdownUnits: readonly ["decade","year","month","week","day","hour","minute","second"]`, `type CountdownUnit`, `defaultCountdownUnits: CountdownUnit[]`, `paddedCountdownUnits: ReadonlySet<CountdownUnit>`, `normalizeCountdownUnits(units: readonly string[]): CountdownUnit[]`.
  - `interface CountdownPart { unit: CountdownUnit; value: number }`, `getCountdownBreakdown(from: Date, to: Date, units: readonly CountdownUnit[], timeZone: string): CountdownPart[]`, `trimLeadingZeroParts(parts: CountdownPart[]): CountdownPart[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/widgets/src/countdown-display/duration.spec.ts
import { describe, expect, it } from "vitest";

import { getCountdownBreakdown, trimLeadingZeroParts } from "./duration";
import type { CountdownPart } from "./duration";
import { normalizeCountdownUnits } from "./units";
import type { CountdownUnit } from "./units";

const detroit = "America/Detroit";

const breakdown = (from: string, to: string, units: CountdownUnit[], timeZone = detroit) =>
  getCountdownBreakdown(new Date(from), new Date(to), units, timeZone).map(({ unit, value }) => [unit, value]);

// All Detroit instants below are 09:00 local unless stated. EDT = UTC-4, EST = UTC-5.
const oct12 = "2026-10-12T13:00:00.000Z"; // 2026-10-12 09:00 EDT
const nov26 = "2026-11-26T14:00:00.000Z"; // 2026-11-26 09:00 EST (45 days later)

describe("normalizeCountdownUnits", () => {
  it("orders, deduplicates and drops unknown values", () => {
    expect(normalizeCountdownUnits(["second", "day", "day", "bogus", "month"])).toEqual(["month", "day", "second"]);
  });

  it("falls back to the default set when nothing valid is selected", () => {
    expect(normalizeCountdownUnits([])).toEqual(["day", "hour", "minute"]);
    expect(normalizeCountdownUnits(["bogus"])).toEqual(["day", "hour", "minute"]);
  });
});

describe("getCountdownBreakdown", () => {
  it("rolls a hidden week unit into days", () => {
    expect(breakdown(oct12, nov26, ["month", "week", "day"])).toEqual([
      ["month", 1],
      ["week", 2],
      ["day", 0],
    ]);
    expect(breakdown(oct12, nov26, ["month", "day"])).toEqual([
      ["month", 1],
      ["day", 14],
    ]);
    expect(breakdown(oct12, nov26, ["day"])).toEqual([["day", 45]]);
  });

  it("clamps month steps to the end of shorter months", () => {
    // 2026-01-31 09:00 EST -> 2026-03-01 09:00 EST
    expect(breakdown("2026-01-31T14:00:00.000Z", "2026-03-01T14:00:00.000Z", ["month", "day"])).toEqual([
      ["month", 1],
      ["day", 1],
    ]);
    // 2026-01-31 09:00 EST -> 2026-03-31 09:00 EDT (two whole months from Jan 31)
    expect(breakdown("2026-01-31T14:00:00.000Z", "2026-03-31T13:00:00.000Z", ["month", "day"])).toEqual([
      ["month", 2],
      ["day", 0],
    ]);
  });

  it("rolls hidden higher units downward", () => {
    // 2026-01-01 09:00 EST -> 2027-03-01 09:00 EST
    expect(breakdown("2026-01-01T14:00:00.000Z", "2027-03-01T14:00:00.000Z", ["month"])).toEqual([["month", 14]]);
  });

  it("splits decades and years, or decades and months", () => {
    const from = "2026-01-01T14:00:00.000Z"; // 2026-01-01 09:00 EST
    const to = "2049-01-01T14:00:00.000Z"; // 2049-01-01 09:00 EST
    expect(breakdown(from, to, ["decade", "year"])).toEqual([
      ["decade", 2],
      ["year", 3],
    ]);
    expect(breakdown(from, to, ["decade", "month"])).toEqual([
      ["decade", 2],
      ["month", 36],
    ]);
  });

  it("treats a DST fall-back day as one day, or 25 hours", () => {
    const from = "2026-11-01T03:00:00.000Z"; // 2026-10-31 23:00 EDT
    const to = "2026-11-02T04:00:00.000Z"; // 2026-11-01 23:00 EST
    expect(breakdown(from, to, ["day", "hour"])).toEqual([
      ["day", 1],
      ["hour", 0],
    ]);
    expect(breakdown(from, to, ["hour"])).toEqual([["hour", 25]]);
  });

  it("treats a DST spring-forward day as one day", () => {
    const from = "2026-03-07T17:00:00.000Z"; // 2026-03-07 12:00 EST
    const to = "2026-03-08T16:00:00.000Z"; // 2026-03-08 12:00 EDT
    expect(breakdown(from, to, ["day", "hour"])).toEqual([
      ["day", 1],
      ["hour", 0],
    ]);
  });

  it("returns zeros when the target is reached or passed", () => {
    expect(breakdown(nov26, nov26, ["day", "hour"])).toEqual([
      ["day", 0],
      ["hour", 0],
    ]);
    expect(breakdown(nov26, oct12, ["month", "second"])).toEqual([
      ["month", 0],
      ["second", 0],
    ]);
  });

  it("counts seconds", () => {
    expect(breakdown(oct12, "2026-10-12T13:00:05.000Z", ["day", "hour", "minute", "second"])).toEqual([
      ["day", 0],
      ["hour", 0],
      ["minute", 0],
      ["second", 5],
    ]);
  });

  it("keeps sub-second precision of now", () => {
    expect(breakdown("2026-10-12T13:00:00.500Z", "2026-10-12T13:00:05.000Z", ["second"])).toEqual([["second", 4]]);
  });

  it("steps months on the event zone's calendar", () => {
    // from = 2026-01-31 00:30 JST (still Jan 30 in UTC); to = 2026-02-28 09:30 JST.
    // On the Tokyo calendar that is one month (Jan 31 -> Feb 28, clamped) plus nine hours.
    // A UTC reading would see Jan 30 15:30 -> Feb 28 00:30 and report 0 months 28 days 9 hours.
    const from = "2026-01-30T15:30:00.000Z";
    const to = "2026-02-28T00:30:00.000Z";
    expect(breakdown(from, to, ["month", "day", "hour"], "Asia/Tokyo")).toEqual([
      ["month", 1],
      ["day", 0],
      ["hour", 9],
    ]);
  });

  it("rolls everything into seconds for a very long countdown", () => {
    const from = new Date("2026-01-01T14:00:00.000Z");
    const to = new Date("2049-01-01T14:00:00.000Z");
    const expected = Math.floor((to.getTime() - from.getTime()) / 1000);
    expect(getCountdownBreakdown(from, to, ["second"], detroit)).toEqual([{ unit: "second", value: expected }]);
  });

  it("does not throw for an unsupported time zone", () => {
    expect(() => breakdown(oct12, nov26, ["month", "day"], "Not/AZone")).not.toThrow();
    expect(breakdown(oct12, nov26, ["day"], "Not/AZone")).toEqual([["day", 45]]);
  });
});

describe("trimLeadingZeroParts", () => {
  const parts: CountdownPart[] = [
    { unit: "day", value: 0 },
    { unit: "hour", value: 0 },
    { unit: "minute", value: 7 },
    { unit: "second", value: 0 },
  ];

  it("drops zero parts before the first non-zero part only", () => {
    expect(trimLeadingZeroParts(parts)).toEqual([
      { unit: "minute", value: 7 },
      { unit: "second", value: 0 },
    ]);
  });

  it("keeps the last part when everything is zero", () => {
    expect(trimLeadingZeroParts(parts.map((part) => ({ ...part, value: 0 })))).toEqual([{ unit: "second", value: 0 }]);
  });

  it("keeps everything when the first part is non-zero", () => {
    expect(trimLeadingZeroParts(parts.map((part) => ({ ...part, value: 1 })))).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/steve/src/homarr-widget-countdowns && bun run test packages/widgets/src/countdown-display/duration.spec.ts`
Expected: FAIL — cannot resolve `./duration` / `./units`.

- [ ] **Step 3: Write `units.ts`**

```ts
// packages/widgets/src/countdown-display/units.ts
export const countdownUnits = ["decade", "year", "month", "week", "day", "hour", "minute", "second"] as const;

export type CountdownUnit = (typeof countdownUnits)[number];

export const defaultCountdownUnits: CountdownUnit[] = ["day", "hour", "minute"];

/** Units rendered with two digits so the tiles do not jitter while ticking. */
export const paddedCountdownUnits: ReadonlySet<CountdownUnit> = new Set<CountdownUnit>(["hour", "minute", "second"]);

/** Keeps known units in canonical descending order; an empty result falls back to the defaults. */
export const normalizeCountdownUnits = (units: readonly string[]): CountdownUnit[] => {
  const selected = countdownUnits.filter((unit) => units.includes(unit));
  return selected.length > 0 ? selected : [...defaultCountdownUnits];
};
```

- [ ] **Step 4: Write `duration.ts`**

```ts
// packages/widgets/src/countdown-display/duration.ts
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

const countWholeSteps = (
  cursor: WallDateTime,
  unit: CalendarUnit,
  targetMs: number,
  timeZone: string,
  offsetMs: number,
) => {
  const instantOf = (count: number) => toInstantMs(addWallUnit(cursor, unit, count), timeZone) + offsetMs;
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
  // Wall values have whole seconds; carry the sub-second remainder of `from` so it is never lost.
  const offsetMs = from.getTime() - toInstantMs(cursor, timeZone);

  for (const unit of ordered) {
    if (!isCalendarUnit(unit)) continue;
    const value = countWholeSteps(cursor, unit, targetMs, timeZone, offsetMs);
    parts.push({ unit, value });
    cursor = addWallUnit(cursor, unit, value);
  }

  let remainingMs = targetMs - (toInstantMs(cursor, timeZone) + offsetMs);
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test packages/widgets/src/countdown-display/duration.spec.ts`
Expected: PASS, all cases. If the Tokyo case fails by one hour, re-check that `offsetMs` is added inside `instantOf` (it must be) and that the test's instants match the comment.

- [ ] **Step 6: Lint, format, typecheck**

Run: `bun run --filter @homarr/widgets lint && bun run --filter @homarr/widgets format && bun run --filter @homarr/widgets typecheck`
Expected: no errors. Fix anything oxlint reports (it may ask for `switch` exhaustiveness or `unicorn` naming).

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/src/countdown-display/units.ts packages/widgets/src/countdown-display/duration.ts packages/widgets/src/countdown-display/duration.spec.ts
git -c commit.gpgsign=false commit -m "feat(widgets): calendar-aware countdown breakdown

Claude-Session: https://claude.ai/code/session_01WGNUBWcdTtxMKubYqH5v79"
```

---

### Task 2: Font registry and bundled font dependencies

**Files:**
- Modify: root `package.json` (`workspaces.catalog`, alphabetical position)
- Modify: `packages/widgets/package.json` (`dependencies`, alphabetical position)
- Modify: `bun.lock` (via `bun install`)
- Create: `packages/widgets/src/countdown-display/fonts.ts`
- Test: `packages/widgets/src/countdown-display/fonts.spec.ts`

**Interfaces:**
- Produces: `countdownFontKeys: readonly ["default","jetbrainsMono","spaceGrotesk","orbitron","bebasNeue","sevenSegment"]`, `type CountdownFontKey`, `interface CountdownFont { family: string | undefined; sevenSegment: boolean; label: string | undefined }` (label `undefined` means "translate `widget.countdownDisplay.font.default`"), `countdownFonts: Record<CountdownFontKey, CountdownFont>`, `getCountdownFont(key: string): CountdownFont` (unknown → `countdownFonts.default`), `countdownFontCssImports: readonly string[]` (the five CSS specifiers; `component.tsx` imports them literally, this list exists for the test and `FORK.md`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/widgets/src/countdown-display/fonts.spec.ts
import { describe, expect, it } from "vitest";

import { countdownFontKeys, countdownFonts, getCountdownFont } from "./fonts";

describe("countdown fonts", () => {
  it("lists every registry key", () => {
    expect(Object.keys(countdownFonts).sort()).toEqual([...countdownFontKeys].sort());
  });

  it("inherits the theme font for the default entry", () => {
    expect(countdownFonts.default.family).toBeUndefined();
    expect(countdownFonts.default.sevenSegment).toBe(false);
  });

  it("marks only DSEG7 as seven-segment", () => {
    const sevenSegmentKeys = countdownFontKeys.filter((key) => countdownFonts[key].sevenSegment);
    expect(sevenSegmentKeys).toEqual(["sevenSegment"]);
    expect(countdownFonts.sevenSegment.family).toContain("DSEG7 Classic");
  });

  it("falls back to default for unknown keys", () => {
    expect(getCountdownFont("comicSans")).toBe(countdownFonts.default);
    expect(getCountdownFont("orbitron")).toBe(countdownFonts.orbitron);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test packages/widgets/src/countdown-display/fonts.spec.ts`
Expected: FAIL — cannot resolve `./fonts`.

- [ ] **Step 3: Add the dependencies**

In root `package.json`, inside `workspaces.catalog`, add (keep alphabetical order among the `@`-scoped entries):

```json
      "@fontsource-variable/jetbrains-mono": "5.3.0",
      "@fontsource-variable/space-grotesk": "5.3.0",
      "@fontsource/bebas-neue": "5.3.0",
      "@fontsource/dseg7-classic": "5.3.0",
      "@fontsource/orbitron": "5.3.0",
```

In `packages/widgets/package.json` `dependencies`, add (alphabetical):

```json
    "@fontsource-variable/jetbrains-mono": "catalog:",
    "@fontsource-variable/space-grotesk": "catalog:",
    "@fontsource/bebas-neue": "catalog:",
    "@fontsource/dseg7-classic": "catalog:",
    "@fontsource/orbitron": "catalog:",
```

Run: `cd /home/steve/src/homarr-widget-countdowns && bun install`
Expected: succeeds, `bun.lock` changes, and `ls node_modules/@fontsource/dseg7-classic/700.css node_modules/@fontsource-variable/space-grotesk/wght.css` lists both files.

- [ ] **Step 4: Write `fonts.ts`**

```ts
// packages/widgets/src/countdown-display/fonts.ts
export const countdownFontKeys = [
  "default",
  "jetbrainsMono",
  "spaceGrotesk",
  "orbitron",
  "bebasNeue",
  "sevenSegment",
] as const;

export type CountdownFontKey = (typeof countdownFontKeys)[number];

export interface CountdownFont {
  /** CSS font-family; undefined inherits the dashboard font. */
  family: string | undefined;
  /** DSEG-style face: digits only, rendered bold with a touch of tracking. */
  sevenSegment: boolean;
  /** Literal option label; undefined means the label is translated. */
  label: string | undefined;
}

export const countdownFonts: Record<CountdownFontKey, CountdownFont> = {
  default: { family: undefined, sevenSegment: false, label: undefined },
  jetbrainsMono: { family: '"JetBrains Mono Variable", monospace', sevenSegment: false, label: "JetBrains Mono" },
  spaceGrotesk: { family: '"Space Grotesk Variable", sans-serif', sevenSegment: false, label: "Space Grotesk" },
  orbitron: { family: '"Orbitron", sans-serif', sevenSegment: false, label: "Orbitron" },
  bebasNeue: { family: '"Bebas Neue", sans-serif', sevenSegment: false, label: "Bebas Neue" },
  sevenSegment: { family: '"DSEG7 Classic", monospace', sevenSegment: true, label: "7-segment (DSEG7)" },
};

const isCountdownFontKey = (key: string): key is CountdownFontKey =>
  (countdownFontKeys as readonly string[]).includes(key);

/** Resolves a stored option value; keys from older saves that no longer exist use the default. */
export const getCountdownFont = (key: string): CountdownFont =>
  isCountdownFontKey(key) ? countdownFonts[key] : countdownFonts.default;

/**
 * Self-hosted fontsource stylesheets backing the registry. `component.tsx` imports these literally
 * (bundlers need static specifiers); keep both lists in sync.
 */
export const countdownFontCssImports = [
  "@fontsource-variable/jetbrains-mono/wght.css",
  "@fontsource-variable/space-grotesk/wght.css",
  "@fontsource/orbitron/700.css",
  "@fontsource/bebas-neue/400.css",
  "@fontsource/dseg7-classic/700.css",
] as const;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test packages/widgets/src/countdown-display/fonts.spec.ts`
Expected: PASS.

- [ ] **Step 6: Lint, format, lockfile sanity**

Run: `bun run --filter @homarr/widgets lint && bun run --filter @homarr/widgets format && bun run lint:ws`
Expected: no errors; `sherif` (lint:ws) reports no catalog mismatch.

- [ ] **Step 7: Commit**

```bash
git add package.json packages/widgets/package.json bun.lock packages/widgets/src/countdown-display/fonts.ts packages/widgets/src/countdown-display/fonts.spec.ts
git -c commit.gpgsign=false commit -m "feat(widgets): countdown display fonts

Claude-Session: https://claude.ai/code/session_01WGNUBWcdTtxMKubYqH5v79"
```

---

### Task 3: Register the `countdownDisplay` widget kind

**Files:**
- Modify: `packages/definitions/src/widget.ts` (`widgetKinds` after `"countdown"`; `widgetDefaultSizes`)
- Modify: `packages/widgets/src/registry.ts` (type import, `widgetModuleLoaders`, `WidgetImports`, `widgetComponentLoaders`)
- Modify: `packages/ui/src/widget-icons.ts`
- Modify: `packages/definitions/src/docs/widget-doc-slugs.ts`
- Modify: `packages/definitions/src/docs/sitemap-paths.json`
- Regenerate: `packages/definitions/src/docs/homarr-docs-sitemap.ts`
- Modify: `packages/translation/src/lang/en.json` (new `widget.countdownDisplay` block after `widget.countdown`)
- Create: `packages/widgets/src/countdown-display/index.ts`
- Create: `packages/widgets/src/countdown-display/component.tsx` (placeholder, replaced in Task 5)
- Create: `apps/docs/docs/widgets/countdown-display/index.mdx`, `apps/docs/docs/widgets/countdown-display/index.ts`
- Regenerate: `apps/docs/public/api/open-api-schema.json`

**Interfaces:**
- Consumes: `countdownUnits`, `defaultCountdownUnits` (Task 1); `countdownFontKeys`, `countdownFonts` (Task 2); `optionsBuilder`, `createWidgetDefinition`, `getTimeZoneOptions` (existing).
- Produces: widget kind `"countdownDisplay"` with options `{ events, units, font, scale, glow, showProgress }` typed as in the spec; translation namespace `widget.countdownDisplay`; `WidgetComponentProps<"countdownDisplay">` available to Task 5.

- [ ] **Step 1: Declare the kind**

In `packages/definitions/src/widget.ts`, add `"countdownDisplay",` on the line after `"countdown",` in `widgetKinds`, and add `countdownDisplay: { width: 3, height: 2 },` after the `countdown:` line in `widgetDefaultSizes`.

- [ ] **Step 2: Icon and docs slug**

`packages/ui/src/widget-icons.ts`: after `countdown: IconHourglass,` add `countdownDisplay: IconHourglassHigh,` and add `IconHourglassHigh` to the existing `@tabler/icons-react` import list (alphabetical within the list).

`packages/definitions/src/docs/widget-doc-slugs.ts`: after `countdown: "countdown",` add `countdownDisplay: "countdown-display",`.

`packages/definitions/src/docs/sitemap-paths.json`: after the line `"/docs/widgets/countdown",` add `"/docs/widgets/countdown-display",`.

Run: `bun run --filter @homarr/definitions docs:generate`
Expected: `homarr-docs-sitemap.ts` now contains `| "/docs/widgets/countdown-display"`. (`docs:generate` without `--refresh` reads the JSON snapshot; it never touches the network.)

- [ ] **Step 3: Translations**

In `packages/translation/src/lang/en.json`, directly after the closing brace of the `"countdown": { … }` object inside `"widget"` (the next key is `"timer"`), insert:

```json
    "countdownDisplay": {
      "name": "Countdown display",
      "description": "Large segmented countdown with selectable units and fonts.",
      "option": {
        "events": {
          "label": "Events",
          "description": "Add and order up to 20 one-time or yearly countdowns. Dates are entered in the selected timezone. The first event is shown large."
        },
        "units": {
          "label": "Units shown",
          "description": "Pick the units to display. Time from a hidden unit rolls into the next shown one."
        },
        "font": {
          "label": "Numeral font",
          "description": "Font for the numbers. Labels keep the dashboard font."
        },
        "scale": {
          "label": "Size",
          "description": "Scales the auto-fitted numerals, in percent."
        },
        "glow": {
          "label": "Glow",
          "description": "Adds a soft lighter glow behind the numbers."
        },
        "showProgress": {
          "label": "Show progress"
        }
      },
      "font": {
        "default": "Dashboard font"
      },
      "unit": {
        "decade": { "label": "Decades", "long": "{count, plural, one {decade} other {decades}}", "short": "dec" },
        "year": { "label": "Years", "long": "{count, plural, one {year} other {years}}", "short": "yr" },
        "month": { "label": "Months", "long": "{count, plural, one {month} other {months}}", "short": "mo" },
        "week": { "label": "Weeks", "long": "{count, plural, one {week} other {weeks}}", "short": "wk" },
        "day": { "label": "Days", "long": "{count, plural, one {day} other {days}}", "short": "d" },
        "hour": { "label": "Hours", "long": "{count, plural, one {hour} other {hours}}", "short": "h" },
        "minute": { "label": "Minutes", "long": "{count, plural, one {minute} other {minutes}}", "short": "min" },
        "second": { "label": "Seconds", "long": "{count, plural, one {second} other {seconds}}", "short": "s" }
      },
      "empty": {
        "title": "No countdowns yet",
        "description": "Add an event in widget options to start counting down."
      },
      "completed": "Completed",
      "yearly": "Yearly",
      "progress": "Event progress",
      "upcoming": "Upcoming",
      "completedEvents": "Completed events",
      "invalid": {
        "title": "Some events cannot be displayed",
        "description": "{count, plural, one {One event has an invalid date or unsupported timezone.} other {# events have an invalid date or unsupported timezone.}}",
        "value": "Unavailable"
      }
    },
```

Then run `bun run --filter @homarr/translation format` (oxfmt reflows the one-line unit objects to the file's style). Verify with `node -e "JSON.parse(require('fs').readFileSync('packages/translation/src/lang/en.json','utf8'))"` that the file is valid JSON.

- [ ] **Step 4: Widget definition**

```ts
// packages/widgets/src/countdown-display/index.ts
import { IconHourglassHigh } from "@tabler/icons-react";
import { z } from "zod/v4";

import { getTimeZoneOptions } from "../clock/world-clock";
import { createWidgetDefinition } from "../definition";
import { optionsBuilder } from "../options";
import { countdownFontKeys, countdownFonts } from "./fonts";
import { countdownUnits, defaultCountdownUnits } from "./units";

const maximumCountdownEvents = 20;

export const { definition, componentLoader } = createWidgetDefinition("countdownDisplay", {
  icon: IconHourglassHigh,
  supportsAdvancedFocus: true,
  createOptions() {
    return optionsBuilder.from((factory) => ({
      events: factory.dateTimeEventList({
        defaultValue: [],
        maxValues: maximumCountdownEvents,
        timeZoneOptions: getTimeZoneOptions(),
        withDescription: true,
      }),
      units: factory.multiSelect({
        defaultValue: [...defaultCountdownUnits],
        options: countdownUnits.map((unit) => ({
          value: unit,
          label: (t) => t(`widget.countdownDisplay.unit.${unit}.label`),
        })),
        withDescription: true,
      }),
      font: factory.select({
        defaultValue: "default",
        options: countdownFontKeys.map((key) => ({
          value: key,
          label: countdownFonts[key].label ?? ((t) => t("widget.countdownDisplay.font.default")),
        })),
        withDescription: true,
      }),
      scale: factory.slider({
        defaultValue: 100,
        validate: z.number().min(50).max(200),
        step: 5,
        withDescription: true,
      }),
      glow: factory.switch({ defaultValue: false, withDescription: true }),
      showProgress: factory.switch({ defaultValue: true }),
    }));
  },
}).withDynamicImport(() => import("./component"));
```

If `label: (t) => …` fails to typecheck against `stringOrTranslation`, annotate the callback parameter: `(t: TranslationFunction) => …` with `import type { TranslationFunction } from "@homarr/translation";` (check how `packages/widgets/src/media-requests/list/index.ts` types its `label` callbacks and mirror it).

- [ ] **Step 5: Placeholder component**

```tsx
// packages/widgets/src/countdown-display/component.tsx
"use client";

import { Stack, Text } from "@mantine/core";

import type { WidgetComponentProps } from "../definition";

export default function CountdownDisplayWidget({ options }: WidgetComponentProps<"countdownDisplay">) {
  return (
    <Stack h="100%" align="center" justify="center">
      <Text c="dimmed">{options.events.length}</Text>
    </Stack>
  );
}
```

- [ ] **Step 6: Registry**

In `packages/widgets/src/registry.ts`:
- after `import type * as countdown from "./countdown";` add `import type * as countdownDisplay from "./countdown-display";`
- in `widgetModuleLoaders`, after the `countdown:` line add `countdownDisplay: () => import("./countdown-display"),`
- in `WidgetImports`, after `countdown: typeof countdown;` add `countdownDisplay: typeof countdownDisplay;`
- in `widgetComponentLoaders`, after the `countdown:` line add `countdownDisplay: () => import("./countdown-display/component"),`

- [ ] **Step 7: Docs page**

```ts
// apps/docs/docs/widgets/countdown-display/index.ts
import { WidgetDefinition } from "@site/src/types";
import { IconHourglassHigh } from "@tabler/icons-react";

export const countdownDisplayWidget: WidgetDefinition = {
  icon: IconHourglassHigh,
  name: "Countdown display",
  description: "Large segmented countdown with selectable units and fonts.",
  path: "../../widgets/countdown-display",
  configuration: {
    items: [
      {
        name: "Events",
        description: "Add, edit, and order one-time or yearly events with a date, time, and IANA timezone. The first event is shown large.",
        values: "Up to 20 events",
        defaultValue: "No events",
      },
      {
        name: "Units shown",
        description: "Which of decades, years, months, weeks, days, hours, minutes and seconds to display. Time from a hidden unit rolls into the next shown unit, so 45 days reads \"1 month 15 days\" when weeks are hidden.",
        values: { type: "select", options: ["Decades", "Years", "Months", "Weeks", "Days", "Hours", "Minutes", "Seconds"] },
        defaultValue: "Days, Hours, Minutes",
      },
      {
        name: "Numeral font",
        description: "Font for the numbers; labels keep the dashboard font. Fonts are bundled, nothing is fetched at runtime.",
        values: { type: "select", options: ["Dashboard font", "JetBrains Mono", "Space Grotesk", "Orbitron", "Bebas Neue", "7-segment (DSEG7)"] },
        defaultValue: "Dashboard font",
      },
      {
        name: "Size",
        description: "Percent multiplier on the auto-fitted numeral size.",
        values: "50 to 200",
        defaultValue: "100",
      },
      {
        name: "Glow",
        description: "Soft lighter glow behind the numbers.",
        values: { type: "boolean" },
        defaultValue: "no",
      },
      {
        name: "Show progress",
        description: "Show progress from an optional start date, or between yearly occurrences.",
        values: { type: "boolean" },
        defaultValue: "yes",
      },
    ],
  },
};
```

```mdx
---
title: "Countdown display"
description: "Large segmented countdown with selectable units and fonts."
hide_title: true
---

import { WidgetInteractionGuide } from "@site/src/components/widgets/interactions";

import { AddingWidget } from "@site/src/components/widgets/adding";
import { WidgetConfig } from "@site/src/components/widgets/configuration";
import { WidgetHeader } from "@site/src/components/widgets/header";
import { countdownDisplayWidget } from ".";

<WidgetHeader widget={countdownDisplayWidget} categories={["Time"]} />

The Countdown display widget shows the first of up to 20 one-time or yearly events as large tiles, one per
selected unit, and lists the remaining events in advanced view. Units are calendar-accurate in the event's
timezone; hiding a unit rolls its time into the next shown unit. Seconds tick live when selected.

Numerals auto-fit the tile and can be scaled, set in a bundled font (including a seven-segment face) and
given a glow. Browser notifications are not part of this widget; use the Countdowns widget for those.

<WidgetInteractionGuide />

### Adding the widget

<AddingWidget />

### Configuration

<WidgetConfig configuration={countdownDisplayWidget.configuration} />
```

- [ ] **Step 8: OpenAPI snapshot**

Run: `cd /home/steve/src/homarr-widget-countdowns && SKIP_ENV_VALIDATION=true bun run scripts:update-openapi`
Expected: `apps/docs/public/api/open-api-schema.json` gains `"countdownDisplay"` in the widget-kind enums (check with `grep -c countdownDisplay apps/docs/public/api/open-api-schema.json`, expect ≥ 2). If the script needs more env (it imports the tRPC router), prefix the vars it complains about with dummy values, e.g. `SECRET_ENCRYPTION_KEY=$(printf '0%.0s' $(seq 64))`. Then `bun run check:openapi` must pass.

- [ ] **Step 9: Verify**

Run, from the repo root:

```bash
bun run --filter @homarr/definitions --filter @homarr/ui --filter @homarr/widgets --filter @homarr/nextjs typecheck
bun run test packages/widgets/src/test/translation.spec.ts
bun run --filter @homarr/docs validate:coverage
bun run --filter @homarr/widgets --filter @homarr/definitions --filter @homarr/ui lint
bun run --filter @homarr/widgets --filter @homarr/definitions --filter @homarr/ui --filter @homarr/translation format
```

Expected: all pass. The translation spec iterates every widget definition, so a missing `label`/`description` for any `withDescription: true` option fails here with the option name.

- [ ] **Step 10: Commit**

```bash
git add packages/definitions/src/widget.ts packages/widgets/src/registry.ts packages/ui/src/widget-icons.ts packages/definitions/src/docs packages/translation/src/lang/en.json packages/widgets/src/countdown-display/index.ts packages/widgets/src/countdown-display/component.tsx apps/docs/docs/widgets/countdown-display apps/docs/public/api/open-api-schema.json
git -c commit.gpgsign=false commit -m "feat(widgets): register countdownDisplay widget kind

Claude-Session: https://claude.ai/code/session_01WGNUBWcdTtxMKubYqH5v79"
```

---

### Task 4: Tiles and inline renderers with auto-fit CSS

**Files:**
- Create: `packages/widgets/src/countdown-display/tiles.tsx`
- Create: `packages/widgets/src/countdown-display/component.module.css`
- Test: `packages/widgets/src/countdown-display/tiles.spec.tsx`

**Interfaces:**
- Consumes: `CountdownPart` (Task 1), `paddedCountdownUnits` (Task 1).
- Produces: `interface CountdownNumeralStyle { fontFamily: string | undefined; sevenSegment: boolean; glow: boolean; scale: number }`, `getCountdownCells(parts: CountdownPart[]): number`, `CountdownTiles({ parts, numeral }: { parts: CountdownPart[]; numeral: CountdownNumeralStyle })`, `CountdownInline({ parts }: { parts: CountdownPart[] })`. CSS classes: `root`, `hero`, `title`, `status`, `tilesHost`, `inlineHost`, `tiles`, `tile`, `numeral`, `sevenSegment`, `glow`, `label`, `inline`, `target`, `eventCard`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/widgets/src/countdown-display/tiles.spec.tsx
// @vitest-environment jsdom

import { act } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import styles from "./component.module.css";
import type { CountdownPart } from "./duration";
import { CountdownInline, CountdownTiles, getCountdownCells } from "./tiles";
import type { CountdownNumeralStyle } from "./tiles";

vi.mock("@mantine/core", () => {
  const Box = ({ children, className, style }: { children?: ReactNode; className?: string; style?: CSSProperties }) => (
    <div className={className} style={style}>
      {children}
    </div>
  );
  return { Group: Box, Stack: Box, Text: Box };
});

vi.mock("@homarr/translation/client", () => ({
  useI18n: () => (key: string, values?: { count?: number }) => (values ? `${key}:${values.count}` : key),
}));

const parts: CountdownPart[] = [
  { unit: "month", value: 1 },
  { unit: "day", value: 14 },
  { unit: "hour", value: 7 },
  { unit: "minute", value: 32 },
  { unit: "second", value: 9 },
];

const numeral: CountdownNumeralStyle = { fontFamily: undefined, sevenSegment: false, glow: false, scale: 100 };

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
});

const render = async (node: ReactNode) => {
  await act(() => root.render(node));
};

const numerals = () => [...host.querySelectorAll("[data-countdown-unit]")].map((element) => element.textContent);

describe("CountdownTiles", () => {
  it("pads hour, minute and second to two digits and leaves larger units alone", async () => {
    await render(<CountdownTiles parts={parts} numeral={numeral} />);
    expect(numerals()).toEqual(["1", "14", "07", "32", "09"]);
  });

  it("renders plural-aware long labels", async () => {
    await render(<CountdownTiles parts={parts.slice(0, 2)} numeral={numeral} />);
    const labels = [...host.querySelectorAll(`.${styles.label}`)].map((element) => element.textContent);
    expect(labels).toEqual(["month.long:1", "day.long:14"]);
  });

  it("applies font family, seven-segment and glow styling only when configured", async () => {
    await render(
      <CountdownTiles
        parts={parts.slice(0, 1)}
        numeral={{ fontFamily: '"DSEG7 Classic", monospace', sevenSegment: true, glow: true, scale: 150 }}
      />,
    );
    const value = host.querySelector<HTMLElement>("[data-countdown-unit]");
    expect(value?.style.fontFamily).toBe('"DSEG7 Classic", monospace');
    expect(value?.classList.contains(styles.sevenSegment)).toBe(true);
    expect(value?.classList.contains(styles.glow)).toBe(true);

    await render(<CountdownTiles parts={parts.slice(0, 1)} numeral={numeral} />);
    const plain = host.querySelector<HTMLElement>("[data-countdown-unit]");
    expect(plain?.style.fontFamily).toBe("");
    expect(plain?.classList.contains(styles.sevenSegment)).toBe(false);
    expect(plain?.classList.contains(styles.glow)).toBe(false);
  });

  it("exposes cell count and scale as custom properties for the CSS auto-fit", async () => {
    await render(<CountdownTiles parts={parts} numeral={{ ...numeral, scale: 150 }} />);
    const tiles = host.querySelector<HTMLElement>(`.${styles.tiles}`);
    expect(tiles?.style.getPropertyValue("--countdown-cells")).toBe(String(getCountdownCells(parts)));
    expect(tiles?.style.getPropertyValue("--countdown-scale")).toBe("1.5");
  });
});

describe("getCountdownCells", () => {
  it("grows with digit count and tile count", () => {
    const one = getCountdownCells([{ unit: "day", value: 5 }]);
    const twoDigits = getCountdownCells([{ unit: "day", value: 45 }]);
    const twoTiles = getCountdownCells([
      { unit: "day", value: 5 },
      { unit: "hour", value: 5 },
    ]);
    expect(twoDigits).toBeGreaterThan(one);
    expect(twoTiles).toBeGreaterThan(twoDigits);
  });
});

describe("CountdownInline", () => {
  it("joins unpadded values with short labels", async () => {
    await render(<CountdownInline parts={parts} />);
    expect(host.textContent).toBe("1 month.short 14 day.short 7 hour.short 32 minute.short 9 second.short");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test packages/widgets/src/countdown-display/tiles.spec.tsx`
Expected: FAIL — cannot resolve `./tiles` / `./component.module.css`.

- [ ] **Step 3: Write the CSS module**

```css
/* packages/widgets/src/countdown-display/component.module.css */
.root {
  container-type: size;
  overflow: hidden;
}

.hero {
  min-width: 0;
}

.title {
  max-width: 100%;
}

.status {
  font-size: clamp(1.25rem, 12cqw, 3rem);
}

.tiles {
  --countdown-cells: 6;
  --countdown-scale: 1;
  max-width: 100%;
}

.tile {
  /* Auto-fit: share 84% of the container width across all digit cells, cap by height, then scale. */
  font-size: max(1rem, calc(var(--countdown-scale) * min(calc(84cqw / var(--countdown-cells)), 42cqh)));
  line-height: 1;
}

.numeral {
  font-size: 1em;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.sevenSegment {
  font-weight: 700;
  letter-spacing: 0.04em;
}

.glow {
  text-shadow:
    0 0 0.06em color-mix(in srgb, currentColor 45%, white),
    0 0 0.35em color-mix(in srgb, currentColor 35%, transparent);
}

.glow.sevenSegment {
  text-shadow:
    0 0 0.09em color-mix(in srgb, currentColor 45%, white),
    0 0 0.5em color-mix(in srgb, currentColor 35%, transparent);
}

.label {
  font-size: max(0.7rem, 0.22em);
  line-height: 1.2;
  margin-top: 0.15em;
  color: var(--mantine-color-dimmed);
  white-space: nowrap;
}

.inline {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.inlineHost {
  display: none;
}

.target {
  max-width: 100%;
}

.eventCard {
  min-width: 0;
}

@container (max-width: 8rem) {
  .tilesHost {
    display: none;
  }

  .inlineHost {
    display: block;
  }
}

@container (max-width: 11rem) {
  .target {
    display: none;
  }
}

@container (max-height: 7rem) {
  .target {
    display: none;
  }
}
```

- [ ] **Step 4: Write `tiles.tsx`**

```tsx
// packages/widgets/src/countdown-display/tiles.tsx
"use client";

import type { CSSProperties } from "react";
import { Group, Stack, Text } from "@mantine/core";

import { useI18n } from "@homarr/translation/client";

import styles from "./component.module.css";
import type { CountdownPart } from "./duration";
import { paddedCountdownUnits } from "./units";

export interface CountdownNumeralStyle {
  fontFamily: string | undefined;
  sevenSegment: boolean;
  glow: boolean;
  /** Percent, 50-200. */
  scale: number;
}

const digitCellWidth = 0.62;
const tileGapCells = 0.5;

const formatTileValue = (part: CountdownPart) =>
  paddedCountdownUnits.has(part.unit) ? String(part.value).padStart(2, "0") : String(part.value);

/** Approximate width of all tiles in numeral-em units; drives the CSS auto-fit font size. */
export const getCountdownCells = (parts: CountdownPart[]) =>
  parts.reduce((sum, part) => sum + formatTileValue(part).length * digitCellWidth + tileGapCells, 0);

export const CountdownTiles = ({ parts, numeral }: { parts: CountdownPart[]; numeral: CountdownNumeralStyle }) => {
  const t = useI18n("widget.countdownDisplay.unit");
  const numeralClassName = [styles.numeral, numeral.sevenSegment && styles.sevenSegment, numeral.glow && styles.glow]
    .filter(Boolean)
    .join(" ");
  const vars = {
    "--countdown-cells": getCountdownCells(parts),
    "--countdown-scale": numeral.scale / 100,
  } as CSSProperties;

  return (
    <Group className={styles.tiles} gap="0.4em" wrap="nowrap" justify="center" align="flex-start" style={vars}>
      {parts.map((part) => (
        <Stack key={part.unit} className={styles.tile} gap={0} align="center">
          <span className={numeralClassName} style={{ fontFamily: numeral.fontFamily }} data-countdown-unit={part.unit}>
            {formatTileValue(part)}
          </span>
          <span className={styles.label}>{t(`${part.unit}.long`, { count: part.value })}</span>
        </Stack>
      ))}
    </Group>
  );
};

export const CountdownInline = ({ parts }: { parts: CountdownPart[] }) => {
  const t = useI18n("widget.countdownDisplay.unit");
  return (
    <Text className={styles.inline} fw={700}>
      {parts.map((part) => `${part.value} ${t(`${part.unit}.short`)}`).join(" ")}
    </Text>
  );
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test packages/widgets/src/countdown-display/tiles.spec.tsx`
Expected: PASS. Note on CSS modules under vitest: the default config returns a proxy for `*.module.css`, so `styles.label` resolves to a string either way; the test compares against the imported `styles` object, never literal class names.

- [ ] **Step 6: Lint, format, typecheck**

Run: `bun run --filter @homarr/widgets lint && bun run --filter @homarr/widgets format && bun run --filter @homarr/widgets typecheck`
Expected: clean. If `t(\`${part.unit}.long\`, { count })` fails typecheck because of the template key, switch to the explicit namespace form the stock widget uses: `const t = useI18n("widget.countdownDisplay"); t(\`unit.${part.unit}.long\`, { count: part.value })`, and update the expected strings in `tiles.spec.tsx` to the `unit.`-prefixed keys (`unit.month.long:1`, `unit.month.short`, …).

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/src/countdown-display/tiles.tsx packages/widgets/src/countdown-display/component.module.css packages/widgets/src/countdown-display/tiles.spec.tsx
git -c commit.gpgsign=false commit -m "feat(widgets): countdown display tiles

Claude-Session: https://claude.ai/code/session_01WGNUBWcdTtxMKubYqH5v79"
```

---

### Task 5: Widget component

**Files:**
- Modify: `packages/widgets/src/countdown-display/component.tsx` (replace the Task 3 placeholder entirely)

**Interfaces:**
- Consumes: `getCountdownBreakdown`, `trimLeadingZeroParts`, `CountdownPart` (Task 1); `normalizeCountdownUnits`, `CountdownUnit` (Task 1); `getCountdownFont` (Task 2); `CountdownTiles`, `CountdownInline`, `CountdownNumeralStyle` (Task 4); `useWidgetNow(precision)` from `../common/use-widget-now`; `getCountdownEventState`, `getCountdownProgress`, `groupCountdownStates`, `CountdownEventState` from `../countdown/recurrence`; `useCurrentIntlLocale`, `useI18n` from `@homarr/translation/client`.
- Produces: default export `CountdownDisplayWidget`.

- [ ] **Step 1: Write the component**

```tsx
// packages/widgets/src/countdown-display/component.tsx
"use client";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/dseg7-classic/700.css";

import { useMemo } from "react";
import { Alert, Badge, Group, Paper, Progress, ScrollArea, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconHourglassHigh } from "@tabler/icons-react";

import { useCurrentIntlLocale, useI18n } from "@homarr/translation/client";

import { useWidgetNow } from "../common/use-widget-now";
import { getCountdownEventState, getCountdownProgress, groupCountdownStates } from "../countdown/recurrence";
import type { CountdownEventState } from "../countdown/recurrence";
import type { WidgetComponentProps } from "../definition";
import styles from "./component.module.css";
import { getCountdownBreakdown, trimLeadingZeroParts } from "./duration";
import { getCountdownFont } from "./fonts";
import { CountdownInline, CountdownTiles } from "./tiles";
import type { CountdownNumeralStyle } from "./tiles";
import { normalizeCountdownUnits } from "./units";
import type { CountdownUnit } from "./units";

export default function CountdownDisplayWidget({ displayMode, options, width }: WidgetComponentProps<"countdownDisplay">) {
  const units = useMemo(() => normalizeCountdownUnits(options.units), [options.units]);
  const now = useWidgetNow(units.includes("second") ? "second" : "minute");
  const locale = useCurrentIntlLocale();
  const t = useI18n("widget.countdownDisplay");
  const states = useMemo(() => {
    if (!now) return [];
    return options.events.map((event) => getCountdownEventState(event, now));
  }, [now, options.events]);
  const grouped = useMemo(() => groupCountdownStates(states), [states]);
  const font = getCountdownFont(options.font);
  const numeral: CountdownNumeralStyle = {
    fontFamily: font.family,
    sevenSegment: font.sevenSegment,
    glow: options.glow,
    scale: options.scale,
  };

  if (!now) {
    return (
      <Stack h="100%" align="center" justify="center">
        <Text c="dimmed">—</Text>
      </Stack>
    );
  }

  const hero = states[0];
  if (!hero) {
    return (
      <Stack h="100%" align="center" justify="center" gap="xs" p="md">
        <ThemeIcon variant="light" size="xl" radius="xl">
          <IconHourglassHigh />
        </ThemeIcon>
        <Text fw={600}>{t("empty.title")}</Text>
        <Text size="sm" c="dimmed" ta="center">
          {t("empty.description")}
        </Text>
      </Stack>
    );
  }

  if (displayMode !== "advanced") {
    return (
      <Stack className={styles.root} h="100%" justify="center" p="sm">
        <CountdownHero
          state={hero}
          now={now}
          units={units}
          numeral={numeral}
          locale={locale}
          showProgress={options.showProgress}
        />
      </Stack>
    );
  }

  const eventColumns = width >= 700 ? 2 : 1;
  return (
    <Stack className={styles.root} h="100%" gap="md" p="md">
      <Paper withBorder p="lg" radius="md" style={{ flex: "0 0 55%", minHeight: 0 }}>
        <CountdownHero
          state={hero}
          now={now}
          units={units}
          numeral={numeral}
          locale={locale}
          showProgress={options.showProgress}
        />
      </Paper>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap="md" pb="xs">
          <EventSection
            title={t("upcoming")}
            states={grouped.upcoming.filter((state) => state !== hero)}
            now={now}
            units={units}
            locale={locale}
            showProgress={options.showProgress}
            columns={eventColumns}
          />
          <EventSection
            title={t("completedEvents")}
            states={grouped.completed.filter((state) => state !== hero)}
            now={now}
            units={units}
            locale={locale}
            showProgress={options.showProgress}
            columns={eventColumns}
          />
          {grouped.invalid.length > 0 && (
            <Alert color="yellow" title={t("invalid.title")}>
              {t("invalid.description", { count: grouped.invalid.length })}
            </Alert>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

const useTrimmedParts = (state: CountdownEventState, now: Date, units: CountdownUnit[]) =>
  useMemo(() => {
    if (!state.nextOccurrence) return [];
    return trimLeadingZeroParts(getCountdownBreakdown(now, state.nextOccurrence, units, state.event.timeZone));
  }, [now, state.event.timeZone, state.nextOccurrence, units]);

const CountdownHero = ({
  state,
  now,
  units,
  numeral,
  locale,
  showProgress,
}: {
  state: CountdownEventState;
  now: Date;
  units: CountdownUnit[];
  numeral: CountdownNumeralStyle;
  locale: string;
  showProgress: boolean;
}) => {
  const t = useI18n("widget.countdownDisplay");
  const parts = useTrimmedParts(state, now, units);
  let status: string | null = null;
  if (state.invalid) status = t("invalid.value");
  else if (state.completed) status = t("completed");

  return (
    <Stack className={styles.hero} h="100%" gap={4} align="center" justify="center">
      <Text className={styles.title} fw={600} truncate>
        {state.event.label}
      </Text>
      {status ? (
        <Text className={styles.status} fw={700}>
          {status}
        </Text>
      ) : (
        <>
          <div className={styles.tilesHost}>
            <CountdownTiles parts={parts} numeral={numeral} />
          </div>
          <div className={styles.inlineHost}>
            <CountdownInline parts={parts} />
          </div>
        </>
      )}
      <Text className={styles.target} size="xs" c="dimmed" truncate>
        {formatOccurrence(state, locale)}
      </Text>
      {showProgress && <CountdownProgress state={state} now={now} label={t("progress")} />}
    </Stack>
  );
};

const CountdownProgress = ({ state, now, label }: { state: CountdownEventState; now: Date; label: string }) => {
  const progress = getCountdownProgress(state, now);
  if (progress === null) return null;
  return (
    <Progress
      w="100%"
      maw="20rem"
      mt="xs"
      value={progress}
      aria-label={`${label}: ${Math.round(progress)}%`}
      animated={false}
    />
  );
};

const EventCard = ({
  state,
  now,
  units,
  locale,
  showProgress,
  progressLabel,
}: {
  state: CountdownEventState;
  now: Date;
  units: CountdownUnit[];
  locale: string;
  showProgress: boolean;
  progressLabel: string;
}) => {
  const t = useI18n("widget.countdownDisplay");
  const parts = useTrimmedParts(state, now, units);
  let value: React.ReactNode = <CountdownInline parts={parts} />;
  if (state.invalid) value = <Text fw={700}>{t("invalid.value")}</Text>;
  else if (state.completed) value = <Text fw={700}>{t("completed")}</Text>;

  return (
    <Paper className={styles.eventCard} withBorder p="sm">
      <Stack gap={4} h="100%">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600} truncate>
            {state.event.label}
          </Text>
          {state.event.recurrence === "yearly" && <Badge variant="outline">{t("yearly")}</Badge>}
        </Group>
        {value}
        <Stack gap={4} mt="auto">
          {showProgress && <CountdownProgress state={state} now={now} label={progressLabel} />}
          <Text size="xs" c="dimmed">
            {formatOccurrence(state, locale)}
          </Text>
        </Stack>
      </Stack>
    </Paper>
  );
};

const EventSection = ({
  title,
  states,
  now,
  units,
  locale,
  showProgress,
  columns,
}: {
  title: string;
  states: CountdownEventState[];
  now: Date;
  units: CountdownUnit[];
  locale: string;
  showProgress: boolean;
  columns: number;
}) => {
  if (states.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text fw={700}>{title}</Text>
      <SimpleGrid cols={columns} spacing="xs">
        {states.map((state) => (
          <EventCard
            key={state.event.id}
            state={state}
            now={now}
            units={units}
            locale={locale}
            showProgress={showProgress}
            progressLabel={title}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
};

const formatOccurrence = (state: CountdownEventState, locale: string) => {
  const occurrence = state.nextOccurrence ?? state.previousOccurrence;
  if (!occurrence) return state.event.timeZone;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: state.event.timeZone,
  }).format(occurrence);
};
```

Notes for the implementer:
- `React.ReactNode` needs `import type { ReactNode } from "react";` — use that instead of the `React.` qualifier.
- Both advanced sections exclude the hero with `filter((state) => state !== hero)`; the hero may be upcoming, completed or invalid, so `slice(1)` would be wrong.
- `options.units`, `options.font`, `options.scale`, `options.glow` are typed from Task 3's definition; if `options.units` is typed as `CountdownUnit[]` already, `normalizeCountdownUnits` still accepts it.

- [ ] **Step 2: Typecheck, lint, format, run the widget tests**

Run:

```bash
bun run --filter @homarr/widgets typecheck && bun run --filter @homarr/nextjs typecheck
bun run --filter @homarr/widgets lint && bun run --filter @homarr/widgets format
bun run test packages/widgets/src/countdown-display packages/widgets/src/test/translation.spec.ts
```

Expected: all clean/pass.

- [ ] **Step 3: Build the Next app once to prove the CSS/font imports bundle**

Run: `cd /home/steve/src/homarr-widget-countdowns && SKIP_ENV_VALIDATION=true CI=true bun run turbo run build --filter=@homarr/nextjs...`
Expected: build succeeds (this takes several minutes). Then `ls apps/nextjs/.next/static/media | grep -i -E 'dseg7|orbitron|bebas|space-grotesk|jetbrains'` lists at least one woff2 per family. If the build fails on the CSS imports, move the five `import "...css"` lines into `apps/nextjs/src/app/[locale]/layout.tsx` next to the existing CSS imports and record that in the commit message; do not drop the fonts.

- [ ] **Step 4: Commit**

```bash
git add packages/widgets/src/countdown-display/component.tsx
git -c commit.gpgsign=false commit -m "feat(widgets): countdown display component

Claude-Session: https://claude.ai/code/session_01WGNUBWcdTtxMKubYqH5v79"
```

---

### Task 6: Fork maintenance guide

**Files:**
- Create: `FORK.md`
- Modify: `README.md` (two lines at the very top)

**Interfaces:**
- Consumes: the touchpoint list from the spec and the exact file names created in Tasks 1–5.

- [ ] **Step 1: Write `FORK.md`**

```markdown
# Fork notes: countdown display widget

This is [stevenwcarter/homarr](https://github.com/stevenwcarter/homarr), a fork of
[homarr-labs/homarr](https://github.com/homarr-labs/homarr) that adds one widget, **Countdown display**
(`countdownDisplay`). Design: `docs/superpowers/specs/2026-10-12-countdown-display-design.md`.
Everything else is upstream, unmodified.

## Branch model

| Remote | URL | Role |
| --- | --- | --- |
| `origin` | `git@github.com:stevenwcarter/homarr.git` | the fork; `countdown-display` lives here |
| `upstream` | `https://github.com/homarr-labs/homarr.git` | read-only; release tags come from here |

Branch `countdown-display` is a short series of commits rebased on top of the upstream release tag that is
deployed. It is force-pushed after every rebase. Never push to `upstream`.

## What the branch touches

Widget code (fork-only, never conflicts): `packages/widgets/src/countdown-display/**`, `FORK.md`,
`docs/superpowers/**`, `apps/docs/docs/widgets/countdown-display/**`.

Upstream files edited (conflicts land here):

| File | Our change | On conflict |
| --- | --- | --- |
| `packages/definitions/src/widget.ts` | `"countdownDisplay"` in `widgetKinds`; default size `3×2` | keep both sides' additions, keep ours after `"countdown"` |
| `packages/widgets/src/registry.ts` | four `countdownDisplay` entries next to `countdown` | same |
| `packages/ui/src/widget-icons.ts` | `countdownDisplay: IconHourglassHigh` | same |
| `packages/definitions/src/docs/widget-doc-slugs.ts` | `countdownDisplay: "countdown-display"` | same |
| `packages/definitions/src/docs/sitemap-paths.json` | `/docs/widgets/countdown-display` | keep both; then re-run `bun run --filter @homarr/definitions docs:generate` |
| `packages/definitions/src/docs/homarr-docs-sitemap.ts` | generated | take upstream, re-run the generator |
| `packages/translation/src/lang/en.json` | `widget.countdownDisplay` block after `widget.countdown` | keep both blocks; validate JSON |
| `package.json` (catalog), `packages/widgets/package.json`, `bun.lock` | five `@fontsource*` deps | keep both; run `bun install`, commit the lockfile |
| `apps/docs/public/api/open-api-schema.json` | regenerated | take upstream, re-run `SKIP_ENV_VALIDATION=true bun run scripts:update-openapi` |
| `README.md` | two-line pointer at the top | keep ours at the top |

## Updating to a new Homarr release

```bash
cd ~/src/homarr-widget-countdowns
git fetch upstream --tags
git checkout countdown-display
git rebase vNEW            # e.g. v2.5.0; resolve conflicts per the table above
bun install --frozen-lockfile || bun install   # frozen fails only when upstream changed the lockfile
bun run --filter @homarr/definitions docs:generate
SKIP_ENV_VALIDATION=true bun run scripts:update-openapi
```

Then run the verification below, commit any regenerated files into the commit that owns them
(`git rebase -i` is not needed: `git add` + `git commit --fixup` + `git rebase --autosquash vNEW` keeps the
series tidy), and push:

```bash
git push --force-with-lease origin countdown-display
```

If upstream changed `packages/widgets/src/countdown/recurrence.ts` (we import `formatWallDateTime`,
`parseWallDateTime`, `resolveWallDateTime`, `getCountdownEventState`, `getCountdownProgress`,
`groupCountdownStates`), the typecheck and `duration.spec.ts` will say so.

## Verification

```bash
bun run test packages/widgets/src/countdown-display packages/widgets/src/test/translation.spec.ts
bun run --filter @homarr/definitions --filter @homarr/ui --filter @homarr/widgets --filter @homarr/nextjs typecheck
bun run --filter @homarr/widgets lint && bun run --filter @homarr/widgets format
bun run --filter @homarr/docs validate:coverage
bun run check:openapi
```

## Build and push the image

Tag scheme: `<upstream tag>-countdown.<n>`; `n` restarts at 1 for each upstream tag and increments for
fork-only changes on the same upstream version.

```bash
docker buildx build --platform linux/amd64 \
  -t 192.168.42.134:5000/homarr:vNEW-countdown.1 --push .
```

The Dockerfile runs `bun install --frozen-lockfile`, so the committed `bun.lock` must match
`package.json`. The build takes several minutes and needs network access for npm only.

Quick check that the fonts made it into the image:

```bash
docker run --rm 192.168.42.134:5000/homarr:vNEW-countdown.1 \
  sh -c 'ls /app/apps/nextjs/.next/static/media | grep -i -E "dseg7|orbitron|bebas|grotesk|jetbrains"'
```

## Deploy

In `~/k8s-config/kubernetes/apps/homarr/`:

1. `values.yaml`: set `image.tag` to the new tag (and `image.repository` stays `192.168.42.134:5000/homarr`).
2. `kustomization.yaml`: bump the chart `version` if upstream's chart moved with the release
   (`helm show chart oci://ghcr.io/homarr-labs/charts/homarr` lists versions).
3. Commit and push. ArgoCD auto-syncs (`automated` with `selfHeal`), so the push is the deploy.
4. `kubectl -n homarr rollout status deploy/homarr`, then open the board and check a Countdown display tile.

Rollback: revert the values commit and push. To return to the stock image, set `image.repository` to
`ghcr.io/homarr-labs/homarr` and `image.tag` to the upstream tag.

## Upstreaming later

The branch is upstream-shaped (translations, docs page, spec tests, conventional commits). To propose it:
rebase on `upstream/dev`, open a PR from `origin/countdown-display`, and expect to add Crowdin source strings
only (they are generated from `en.json`).
```

- [ ] **Step 2: README pointer**

Insert at the very top of `README.md` (before the first existing line):

```markdown
> **Fork:** this is stevenwcarter/homarr with an added *Countdown display* widget. See [FORK.md](./FORK.md) for what changed and how to rebase onto new Homarr releases.

```

(blank line after the quote so the upstream content keeps its own first paragraph.)

- [ ] **Step 3: Check the commands in `FORK.md` actually exist**

Run: `grep -n '"docs:generate"' packages/definitions/package.json && grep -n '"validate:coverage"' apps/docs/package.json && grep -n '"check:openapi"\|"scripts:update-openapi"' package.json`
Expected: each prints a line. Also `bun run --filter @homarr/docs format` to keep the markdown style consistent if oxfmt covers `.md` (if it reports nothing to do, that is fine).

- [ ] **Step 4: Commit**

```bash
git add FORK.md README.md
git -c commit.gpgsign=false commit -m "docs: fork maintenance guide for the countdown display widget

Claude-Session: https://claude.ai/code/session_01WGNUBWcdTtxMKubYqH5v79"
```

---

### Task 7: Build and push the image; stage the deployment change

**Files:**
- Modify (separate repo): `~/k8s-config/kubernetes/apps/homarr/values.yaml`
- Modify (separate repo): `~/k8s-config/docs/superpowers/specs/2026-10-11-homarr-design.md` (Deployment row)

**Interfaces:**
- Consumes: the branch state after Task 6, `FORK.md` commands.
- Produces: image `192.168.42.134:5000/homarr:v2.4.1-countdown.1` in the registry; one local commit on `~/k8s-config` `main` (not pushed).

- [ ] **Step 1: Confirm the registry and platform**

Run: `grep -n 'insecure' /etc/docker/daemon.json 2>/dev/null; curl -s http://192.168.42.134:5000/v2/_catalog | head -c 300; kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.nodeInfo.architecture}{"\n"}{end}'`
Expected: the registry answers with a JSON catalog, the daemon lists `192.168.42.134:5000` as insecure (or the registry is HTTPS), and nodes are `amd64`. If the push later fails with an HTTPS error, stop and report; do not edit `/etc/docker/daemon.json`.

- [ ] **Step 2: Build and push**

Run (from the fork root; several minutes):

```bash
cd /home/steve/src/homarr-widget-countdowns && git status --porcelain && \
docker buildx build --platform linux/amd64 -t 192.168.42.134:5000/homarr:v2.4.1-countdown.1 --push . 2>&1 | tail -20
```

Expected: `git status` prints nothing (clean tree), build ends with the image pushed (`pushing manifest … done`). Then verify the fonts:

```bash
docker run --rm 192.168.42.134:5000/homarr:v2.4.1-countdown.1 sh -c 'ls /app/apps/nextjs/.next/static/media | grep -i -E "dseg7|orbitron|bebas|grotesk|jetbrains"'
```

Expected: at least five woff2 file names. If the static directory path differs in the standalone output, run `find /app -name "*dseg7*"` inside the container to locate it and update the path in `FORK.md` (commit that fix as `docs: fix font check path in FORK.md`).

- [ ] **Step 3: Smoke-run the container**

```bash
docker run --rm -d --name homarr-smoke -p 7575:7575 -e SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32) 192.168.42.134:5000/homarr:v2.4.1-countdown.1
for i in $(seq 1 60); do curl -sf http://localhost:7575/api/health/ready && break; sleep 2; done; echo
docker logs homarr-smoke 2>&1 | tail -5
docker rm -f homarr-smoke
```

Expected: the health endpoint returns a success body within two minutes and the logs show no error lines. (If `/api/health/ready` is not the right path, `curl -s -o /dev/null -w '%{http_code}' http://localhost:7575/` returning `200` or a redirect `307` is sufficient.)

- [ ] **Step 4: Stage the k8s change**

In `~/k8s-config/kubernetes/apps/homarr/values.yaml`, after the `strategyType: Recreate` line and its comment, add:

```yaml
# Fork image with the Countdown display widget; built from
# github.com/stevenwcarter/homarr branch countdown-display. Tag scheme and the
# update procedure are in that repo's FORK.md. Revert to
# ghcr.io/homarr-labs/homarr + the chart's appVersion to go back to stock.
image:
  repository: 192.168.42.134:5000/homarr
  tag: v2.4.1-countdown.1
```

In `~/k8s-config/docs/superpowers/specs/2026-10-11-homarr-design.md`, extend the `| Deployment |` row so it ends with: `Image: fork \`192.168.42.134:5000/homarr:v2.4.1-countdown.1\` (stevenwcarter/homarr, branch \`countdown-display\`, see its \`FORK.md\`).`

Validate the render still builds: `cd ~/k8s-config && kustomize build --enable-helm kubernetes/apps/homarr | grep -n 'image: 192.168.42.134:5000/homarr:v2.4.1-countdown.1'`
Expected: one matching line (the app container). If `kustomize` is not installed, `kubectl kustomize --enable-helm kubernetes/apps/homarr` is equivalent.

- [ ] **Step 5: Commit locally, do not push**

```bash
cd ~/k8s-config && git add kubernetes/apps/homarr/values.yaml docs/superpowers/specs/2026-10-11-homarr-design.md && \
git -c commit.gpgsign=false commit -m "homarr: switch to fork image v2.4.1-countdown.1 (Countdown display widget)

Claude-Session: https://claude.ai/code/session_01WGNUBWcdTtxMKubYqH5v79" && git status -sb | head -1
```

Expected: `## main...origin/main [ahead 1]`. Do **not** run `git push` here; ArgoCD deploys on push and that is Steve's call.
