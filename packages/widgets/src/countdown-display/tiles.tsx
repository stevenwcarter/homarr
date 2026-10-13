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
/** DSEG7 digits are much wider than proportional digits (plus 0.04em letter-spacing). */
const sevenSegmentDigitCellWidth = 0.86;
const tileGapCells = 0.5;

const formatTileValue = (part: CountdownPart) =>
  paddedCountdownUnits.has(part.unit) ? String(part.value).padStart(2, "0") : String(part.value);

/** Approximate width of all tiles in numeral-em units; drives the CSS auto-fit font size. */
export const getCountdownCells = (parts: CountdownPart[], sevenSegment = false) => {
  const cell = sevenSegment ? sevenSegmentDigitCellWidth : digitCellWidth;
  return Math.max(
    1,
    parts.reduce((sum, part) => sum + formatTileValue(part).length * cell + tileGapCells, 0),
  );
};

export const CountdownTiles = ({ parts, numeral }: { parts: CountdownPart[]; numeral: CountdownNumeralStyle }) => {
  const t = useI18n("widget.countdownDisplay.unit");
  const numeralClassName = [styles.numeral, numeral.sevenSegment && styles.sevenSegment, numeral.glow && styles.glow]
    .filter(Boolean)
    .join(" ");
  const vars = {
    "--countdown-cells": getCountdownCells(parts, numeral.sevenSegment),
    "--countdown-scale": numeral.scale / 100,
  } as CSSProperties;

  return (
    <Group className={styles.tiles} wrap="nowrap" justify="center" align="flex-start" style={vars}>
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
