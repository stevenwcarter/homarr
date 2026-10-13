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
