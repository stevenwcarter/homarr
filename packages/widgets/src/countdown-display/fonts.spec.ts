import { describe, expect, it } from "vitest";

import { countdownFontKeys, countdownFonts, getCountdownFont } from "./fonts";

describe("countdown fonts", () => {
  it("lists every registry key", () => {
    expect(Object.keys(countdownFonts).toSorted()).toEqual([...countdownFontKeys].toSorted());
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
