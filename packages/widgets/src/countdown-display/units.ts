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
