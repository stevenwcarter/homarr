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

// The fontsource stylesheets are imported in `component.tsx`, not here: this file is imported by
// `index.ts`, which the widget registry loads server-side where a `.css` import would not resolve.
