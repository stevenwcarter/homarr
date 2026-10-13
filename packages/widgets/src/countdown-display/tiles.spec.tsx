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
    expect(value?.classList.contains(styles.sevenSegment ?? "")).toBe(true);
    expect(value?.classList.contains(styles.glow ?? "")).toBe(true);

    await render(<CountdownTiles parts={parts.slice(0, 1)} numeral={numeral} />);
    const plain = host.querySelector<HTMLElement>("[data-countdown-unit]");
    expect(plain?.style.fontFamily).toBe("");
    expect(plain?.classList.contains(styles.sevenSegment ?? "")).toBe(false);
    expect(plain?.classList.contains(styles.glow ?? "")).toBe(false);
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
