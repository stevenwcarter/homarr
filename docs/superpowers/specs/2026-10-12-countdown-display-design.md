# Countdown display widget — design

Date: 2026-10-12. Fork branch `countdown-display` on top of upstream tag `v2.4.1`.

## Goal

A second, large-format countdown widget for Homarr, `countdownDisplay` ("Countdown display"),
that sits beside the stock `countdown` widget and leaves it untouched. It shows one event as big
segmented tiles (number above a unit label), lets the user pick which units appear (decade, year,
month, week, day, hour, minute, second) with calendar-accurate rollup into the next shown unit,
ticks every second when seconds are shown, scales the numerals to the tile with a user scale
slider, offers a curated set of bundled fonts including a seven-segment face, and has an optional
glow. The widget ships in a self-built image deployed to Steve's cluster from `~/k8s-config`.

Why a sibling and not a patch of `countdown`: chosen by Steve. The stock widget keeps its behaviour
and options for existing boards; the new widget is free to have a different option set.

Why a fork and not a Custom Widget: Homarr 2.x Custom Widgets render only when their server-side
data query returns (floor: one request per second per viewer) and need an API source, so they
cannot tick a clock.

## Non-goals

- Browser notifications (stay on the stock widget).
- Per-event unit or font settings; all options are per widget.
- Translations beyond `en.json` (Crowdin owns the other locales upstream).
- An upstream pull request now. The change is shaped so one is possible later.
- Pushing the `k8s-config` change. ArgoCD auto-syncs with self-heal, so the push is the deploy;
  it is left to Steve. The image push to the private registry is in scope.

## Repository layout and fork mechanics

- `origin` = `git@github.com:stevenwcarter/homarr.git` (fork), `upstream` =
  `https://github.com/homarr-labs/homarr.git`.
- Branch `countdown-display` is always rebased onto the upstream release tag that is deployed.
  Its history is a short series of commits touching the files listed under "Touchpoints".
- `FORK.md` at the repository root documents the update procedure (see "Fork maintenance
  document"). `README.md` gets a two-line pointer to it at the very top; nothing else in upstream
  prose files is edited.
- Image tag scheme: `<upstream tag>-countdown.<n>` (first: `v2.4.1-countdown.1`), pushed to
  `192.168.42.134:5000/homarr`.

## Widget definition

Directory: `packages/widgets/src/countdown-display/`.

| File | Responsibility |
| --- | --- |
| `index.ts` | `createWidgetDefinition("countdownDisplay", …)`: icon `IconHourglassHigh`, `supportsAdvancedFocus: true`, options below, dynamic import of `./component`. |
| `units.ts` | `countdownUnits` tuple (descending), `CountdownUnit` type, default unit set, `normalizeUnits` (dedupe, order, empty → default). |
| `duration.ts` | Pure calendar-aware breakdown: `getCountdownBreakdown(from, to, units, timeZone)` and `trimLeadingZeroParts`. No React. |
| `duration.spec.ts` | Vitest cases listed under "Testing". |
| `fonts.ts` | Font registry (key → CSS family, seven-segment flag). |
| `tiles.tsx` | Presentational `CountdownTiles` (parts → tiles) and `CountdownInline` (parts → one line). No hooks beyond `useI18n`. |
| `tiles.spec.tsx` | Render tests for padding, hidden leading zeros, font/glow classes. |
| `component.tsx` | `CountdownDisplayWidget`: wires `useWidgetNow`, recurrence states, hero + advanced list; imports the five fontsource stylesheets. |
| `component.module.css` | Container queries, tile sizing, font classes, glow. |

Reused from the stock widget, imported from `../countdown/recurrence` (not copied):
`getCountdownEventState`, `getCountdownProgress`, `groupCountdownStates`, `resolveWallDateTime`,
`parseWallDateTime`, `formatWallDateTime`, `WallDateTime`, `CountdownEventState`. The event list
option is the shared `factory.dateTimeEventList` with `getTimeZoneOptions()` from
`../clock/world-clock`, exactly as `countdown/index.ts` does.

### Options

| Key | Factory | Default | Notes |
| --- | --- | --- | --- |
| `events` | `dateTimeEventList` | `[]` | max 20, `withDescription: true`, time-zone options from the clock widget. First event is the hero. |
| `units` | `multiSelect` | `["day","hour","minute"]` | Options are the eight units; labels translate from `widget.countdownDisplay.unit.<unit>.label`. `withDescription: true`. An empty selection is treated as the default set (normalized in the component, not stored). |
| `font` | `select` | `"default"` | Options: `default` (label translated: "Dashboard font"), `jetbrainsMono` "JetBrains Mono", `spaceGrotesk` "Space Grotesk", `orbitron` "Orbitron", `bebasNeue` "Bebas Neue", `sevenSegment` "7-segment (DSEG7)". Labels other than `default` are literal font names. `withDescription: true`. |
| `scale` | `slider` | `100` | `z.number().min(50).max(200)`, step 5. Percent multiplier on the auto-fit size. `withDescription: true`. |
| `glow` | `switch` | `false` | Soft lighter text-shadow on the numerals. `withDescription: true`. |
| `showProgress` | `switch` | `true` | Same semantics as the stock widget (`getCountdownProgress`). |

Tick precision: `useWidgetNow(units includes "second" ? "second" : "minute")`.

### Duration breakdown (`duration.ts`)

Inputs: `from: Date` (now), `to: Date` (next occurrence), `units: CountdownUnit[]` (already
normalized: deduplicated, descending order, non-empty), `timeZone: string` (the event's IANA zone,
already known to be supported because `getCountdownEventState` marked the event valid).

Output: `CountdownPart[]` where `CountdownPart = { unit: CountdownUnit; value: number }`, one
entry per selected unit, in descending order, values are non-negative integers.

Algorithm:

1. If `to <= from`, every selected unit gets value 0.
2. Calendar units in order `decade, year, month, week, day`, for each selected unit: count the
   largest `n` such that stepping the cursor forward by `n` of that unit does not pass `to`, record
   `{unit, n}`, advance the cursor by `n`. The cursor is a wall-clock value in `timeZone`
   (`WallDateTime` from `../countdown/recurrence`), obtained from `from` via
   `formatWallDateTime` + `parseWallDateTime`, and each candidate is turned back into an instant
   with `resolveWallDateTime` so DST gaps and overlaps are handled by the existing resolver.
   - decade = 10 years, year = 12 months. Month stepping clamps the day to the target month's
     length (Jan 31 + 1 month = Feb 28/29). Steps are always computed from the cursor that
     resulted from the previous unit, never iteratively month by month, so Jan 31 + 2 months is
     Mar 31.
   - week = 7 days; day stepping is wall-clock day arithmetic (a DST day is one day).
   - `n` is estimated from the millisecond difference and corrected with at most a few
     `resolveWallDateTime` probes in each direction. If a probe cannot be resolved (null), the
     naive UTC instant of that wall value is used so the function never throws.
3. Fixed units in order `hour, minute, second`, for each selected unit: `n = floor(remainingMs /
   unitMs)` where `remainingMs` starts at `to − resolve(cursor)` and is reduced after each unit.
4. Unselected units contribute nothing of their own; their span flows into the next lower selected
   unit by construction (weeks off: days count from the month cursor; years off: months count all
   the way, e.g. "14 months"). If no unit lower than some remainder is selected, that remainder
   is dropped (floor), never rounded up.

`trimLeadingZeroParts(parts)` removes zero-valued parts from the front until the first non-zero
part, but always keeps at least the last part. The hero tiles and the inline text both use the
trimmed list.

Worked examples (America/Detroit, both instants at 09:00 local):

| from → to | units | result |
| --- | --- | --- |
| 2026-10-12 → 2026-11-26 | month, week, day | 1 month 2 weeks 0 days |
| 2026-10-12 → 2026-11-26 | month, day | 1 month 14 days |
| 2026-10-12 → 2026-11-26 | day | 45 days |
| 2026-01-31 → 2026-03-01 | month, day | 1 month 1 day |
| 2026-01-31 → 2026-03-31 | month, day | 2 months 0 days |
| 2026-01-01 → 2027-03-01 | month | 14 months |
| 2026-01-01 → 2049-01-01 | decade, year | 2 decades 3 years |
| 2026-01-01 → 2049-01-01 | decade, month | 2 decades 36 months |
| 2026-10-31 23:00 → 2026-11-01 23:00 (fall back) | day, hour | 1 day 0 hours |
| 2026-10-31 23:00 → 2026-11-01 23:00 | hour | 25 hours |
| 2026-03-07 12:00 → 2026-03-08 12:00 (spring forward) | day, hour | 1 day 0 hours |
| any, to ≤ from | any | all zeros |
| 09:00:00 → 09:00:05 | day, hour, minute, second (trimmed) | 5 seconds |

### Fonts (`fonts.ts`)

Dependencies added to `packages/widgets/package.json` via the root `workspaces.catalog`
(repo convention: `"name": "catalog:"` in the package, the version in the root catalog), all at
`5.3.0`: `@fontsource-variable/jetbrains-mono`, `@fontsource-variable/space-grotesk`,
`@fontsource/orbitron`, `@fontsource/bebas-neue`, `@fontsource/dseg7-classic`. Fontsource
packages self-host woff2 files; `bun install` fetches them from npm, nothing is fetched from Google
at build or run time, and each package carries its licence (OFL for all five; DSEG is OFL with
reserved font name "DSEG").

`component.tsx` imports exactly these CSS files (not `fonts.ts`: `index.ts` imports `fonts.ts` and the
registry loads `index.ts` server-side, where a `.css` import would not resolve) so the font chunks load
with the widget, not the app shell (precedent: `video/component.tsx` imports
`video.js/dist/video-js.css`):
`@fontsource-variable/jetbrains-mono/wght.css`, `@fontsource-variable/space-grotesk/wght.css`,
`@fontsource/orbitron/700.css`, `@fontsource/bebas-neue/400.css`,
`@fontsource/dseg7-classic/700.css`.

Registry:

```ts
export const countdownFonts = {
  default: { family: undefined, sevenSegment: false },           // inherit theme font
  jetbrainsMono: { family: '"JetBrains Mono Variable", monospace', sevenSegment: false },
  spaceGrotesk: { family: '"Space Grotesk Variable", sans-serif', sevenSegment: false },
  orbitron: { family: '"Orbitron", sans-serif', sevenSegment: false },
  bebasNeue: { family: '"Bebas Neue", sans-serif', sevenSegment: false },
  sevenSegment: { family: '"DSEG7 Classic", monospace', sevenSegment: true },
} as const;
```

Only numerals use the chosen font. Unit labels, the event title and the target line stay in the
theme font. The seven-segment face has digits, colon, period and minus only, which is all the
numerals need.

### Display (`tiles.tsx`, `component.tsx`, CSS)

Hero (first event), rendered the same way in compact and advanced display modes:

```
┌──────────────────────────────────┐
│          Launch day              │   title: Text fw=600, truncate
│   1      14     07     32   09   │   numerals: chosen font, tabular-nums
│ month   days   hrs    min   sec  │   labels: theme font, dimmed, plural-aware
│   Nov 26, 2026, 9:00 AM          │   target line (hidden on short/narrow tiles)
│ ━━━━━━━━━━━━━━━━━━━━━━━━         │   progress (optional)
└──────────────────────────────────┘
```

- Tiles: one per trimmed part, `Group` with `wrap="nowrap"`. Hour, minute and second values are
  zero-padded to two digits; other units are not padded. Numerals use
  `font-variant-numeric: tabular-nums`.
- Auto-fit: `.root` is a size container. The component sets `--countdown-cells` (sum over the
  tiles of `digits × 0.62 + 0.5` for the gap, a tunable constant) and `--countdown-scale`
  (`scale / 100`) as inline custom properties. The numeral font size is
  `calc(var(--countdown-scale) * min(calc(84cqw / var(--countdown-cells)), 30cqh))`, clamped to a
  minimum of `1rem`. Labels are `0.22em` of the numeral size, minimum `0.6rem`.
- Font: numerals get `style={{ fontFamily }}` from the registry (`undefined` for `default`), and
  the `.sevenSegment` class, which sets `font-weight: 700` and `letter-spacing: 0.04em`.
- Glow: in the dark scheme `.glow` applies
  `text-shadow: 0 0 0.06em color-mix(in srgb, currentColor 45%, white), 0 0 0.35em color-mix(in srgb, currentColor 35%, transparent)`;
  in the light scheme (`[data-mantine-color-scheme="light"] .glow`) only the soft transparent layer
  is kept, because a white core on dark text reads as a grey smudge. `.glow.sevenSegment` widens
  the radii by 1.5× in both schemes.
- Status: invalid event → "Unavailable" text in place of tiles; completed one-time event →
  "Completed" text (translated), no tiles. Empty event list → the same empty state copy pattern as
  the stock widget (hourglass icon, title, description).
- Target line: `Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone })`
  of the next (or previous) occurrence; hidden under `@container (max-height: 7rem)` and
  `@container (max-width: 11rem)`.
- Progress: `Progress` with `getCountdownProgress`, shown only when `showProgress` and progress is
  not null.
- Advanced mode (`displayMode === "advanced"`): hero in a bordered `Paper` taking the top, then a
  `ScrollArea` with "Upcoming" and "Completed events" sections of `Paper` cards (two columns when
  width ≥ 700, else one) showing label, a `CountdownInline` line (trimmed parts as
  `"1 month 14 days"` using the same unit labels, short form), optional progress, and the target
  line. Invalid events get the same yellow `Alert` as the stock widget.
- `CountdownInline` is also what the hero falls back to when the container is narrower than
  `8rem` (via a container query that swaps `display` of the two renderings).

### Translations (`packages/translation/src/lang/en.json`, key `widget.countdownDisplay`)

```
name: "Countdown display"
description: "Large segmented countdown with selectable units and fonts."
option.events.label/description   (same copy as countdown)
option.units.label: "Units shown"
option.units.description: "Pick the units to display. Time from a hidden unit rolls into the next shown one."
option.font.label: "Numeral font"
option.font.description: "Font for the numbers. Labels keep the dashboard font."
option.scale.label: "Size"
option.scale.description: "Scales the auto-fitted numerals, in percent."
option.glow.label: "Glow"
option.glow.description: "Adds a soft lighter glow behind the numbers."
option.showProgress.label: "Show progress"
font.default: "Dashboard font"
unit.<decade|year|month|week|day|hour|minute|second>.label: "Decades" … "Seconds"   (option labels)
unit.<unit>.long: "{count, plural, one {decade} other {decades}}" …   (tile labels)
unit.<unit>.short: "dec" | "yr" | "mo" | "wk" | "d" | "h" | "min" | "s"   (inline)
empty.title / empty.description, completed, progress, upcoming, completedEvents, yearly,
invalid.title / invalid.description / invalid.value   (same copy as countdown)
```

`packages/widgets/src/test/translation.spec.ts` enforces that every option with
`withDescription: true` has `label` and `description`, and every widget has `name` and
`description`; the keys above satisfy it.

## Touchpoints outside the widget directory

These are the only upstream files the branch edits; `FORK.md` lists them for conflict triage.

| File | Change |
| --- | --- |
| `packages/definitions/src/widget.ts` | `"countdownDisplay"` in `widgetKinds` after `"countdown"`; `widgetDefaultSizes.countdownDisplay = { width: 3, height: 2 }`. |
| `packages/widgets/src/registry.ts` | type import, `widgetModuleLoaders`, `WidgetImports`, `widgetComponentLoaders` entries, each next to `countdown`. |
| `packages/ui/src/widget-icons.ts` | `countdownDisplay: IconHourglassHigh`. |
| `packages/definitions/src/docs/widget-doc-slugs.ts` | `countdownDisplay: "countdown-display"`. |
| `packages/definitions/src/docs/sitemap-paths.json` | add `"/docs/widgets/countdown-display"` (sorted position). |
| `packages/definitions/src/docs/homarr-docs-sitemap.ts` | regenerated with `bun run --filter @homarr/definitions docs:generate` (no `--refresh`). |
| `packages/translation/src/lang/en.json` | `widget.countdownDisplay` block. |
| `packages/widgets/package.json` + root `package.json` catalog | five `@fontsource*` dependencies; `bun install` updates `bun.lock`. |
| `apps/docs/docs/widgets/countdown-display/index.mdx`, `index.ts` | new docs page (category "Time"), following `widgets/countdown`. |
| `apps/docs/public/api/open-api-schema.json` | regenerated with `bun run scripts:update-openapi` if the widget-kind enum is part of it (it is; `check:openapi` would otherwise fail). |
| `README.md` | two-line pointer to `FORK.md` at the top. |
| `FORK.md`, `docs/superpowers/**` | fork-only files. |

## Fork maintenance document (`FORK.md`)

Sections, written for Steve to follow when a new Homarr release appears:

1. What this fork is and what it changes (link to this spec; the touchpoint table above).
2. Remotes and branch model (`origin`, `upstream`, `countdown-display` on top of a release tag).
3. Update procedure, as copy-pasteable commands: fetch upstream tags; `git rebase vNEW
   countdown-display`; where conflicts are expected (registry list order, en.json neighbours,
   catalog versions, sitemap json) and how to resolve each; re-run `bun install
   --frozen-lockfile` (or `bun install` when the lockfile legitimately changed); run the checks
   listed in "Verification"; force-push the branch to `origin` (`--force-with-lease`).
4. Build and push the image: `docker buildx build --platform linux/amd64 -t
   192.168.42.134:5000/homarr:vNEW-countdown.1 --push .`, tag scheme, and the note that the
   builder uses `bun install --frozen-lockfile`, so the lockfile must be committed.
5. Deploy: bump `image.tag` in `~/k8s-config/kubernetes/apps/homarr/values.yaml` (and the chart
   `version` in `kustomization.yaml` when upstream's chart moved); commit and push; ArgoCD
   auto-syncs; verify with `kubectl -n homarr rollout status deploy/homarr` and by opening the
   board. Rollback = revert the values commit.
6. Verification checklist (the commands under "Verification" below).
7. Optional: how to turn the branch into an upstream PR later.

## Deployment change (`~/k8s-config`)

`kubernetes/apps/homarr/values.yaml` gains:

```yaml
image:
  repository: 192.168.42.134:5000/homarr
  tag: v2.4.1-countdown.1
```

with a comment pointing at `FORK.md` in the fork. The k8s-config spec
`docs/superpowers/specs/2026-10-11-homarr-design.md` deployment row is updated to mention the
fork image. Committed locally on `main`; not pushed (see Non-goals).

## Testing

Vitest, run through the root config: `bun run test -- packages/widgets/src/countdown-display`.

- `duration.spec.ts`: every row of the worked-examples table, plus: normalization (empty → default
  set, duplicates removed, order fixed); `trimLeadingZeroParts` keeps the last part; `to` exactly
  equal to `from` gives zeros; a resolver miss (unsupported zone string) falls back without
  throwing.
- `tiles.spec.tsx` (testing-library, as `_inputs/*.spec.tsx` do): hour/minute/second padded to two
  digits, decade/year/month/week/day not padded; leading zero tiles absent; `sevenSegment` and
  `glow` classes present exactly when configured; `fontFamily` inline style matches the registry;
  `--countdown-cells` reflects digit count.
- `translation.spec.ts` (existing) passes with the new keys.
- Typecheck: `bun run --filter @homarr/widgets --filter @homarr/definitions --filter @homarr/ui
  --filter @homarr/nextjs typecheck`.
- Lint/format: `bun run --filter @homarr/widgets lint` and `format`.
- Docs coverage: `bun run --filter @homarr/docs validate` (or the script's own invocation,
  `tsx apps/docs/scripts/validate-docs-coverage.ts`).
- OpenAPI snapshot: `bun run check:openapi`.
- Image: `docker buildx build` succeeds; the container starts locally (`docker run --rm -p
  7575:7575 -e SECRET_ENCRYPTION_KEY=<64 hex>`), `/api/health/ready` answers, and the widget
  renders with each font in a browser smoke check (Chrome automation or manual).

### Invariants this feature depends on

- `getCountdownEventState` (stock `recurrence.ts`) marks an event invalid when its zone is
  unsupported and supplies `nextOccurrence`; the breakdown relies on a valid zone. Pinned by the
  "resolver miss falls back" test and by reusing, not copying, the module.
- `factory.dateTimeEventList` stores `targetUtc`, `timeZone`, `startUtc`, `recurrence`; option
  shape changes upstream surface as type errors in `component.tsx`.
- Next.js app router accepts global CSS imports from node_modules inside the transpiled
  `@homarr/widgets` package (`next.config` `transpilePackages`). Pinned today by
  `video/component.tsx`; our `component.tsx` adds five more. A build failure is the signal.
- `useWidgetNow("second")` re-renders once per second and pauses when the tab is hidden.
- CSS `calc()` division by a unitless custom property, container query units (`cqw`, `cqh`) and
  `color-mix()` are available in the browsers Homarr targets (Chromium/Firefox/Safari current).
- Each `getCountdownBreakdown` call costs about 2 ms (day/hour/minute/second) to 5 ms (all eight
  units) on a desktop CPU because each calendar unit makes 2–3 `resolveWallDateTime` probes; the hero
  recomputes once per tick, and every advanced-mode card does too. Memoizing the calendar stage per
  minute is a documented follow-up, not implemented.

## Commit plan (one commit per task, conventional-commit style as upstream uses)

1. `feat(widgets): register countdownDisplay widget kind` (definitions, registry stub, icon, doc
   slug, sitemap, translations block, docs page) — compiles with a placeholder component.
2. `feat(widgets): calendar-aware countdown breakdown` (`units.ts`, `duration.ts`, spec).
3. `feat(widgets): countdown display fonts` (catalog deps, `fonts.ts`, lockfile).
4. `feat(widgets): countdown display tiles` (`tiles.tsx`, CSS, spec).
5. `feat(widgets): countdown display component` (`component.tsx`, option wiring, docs copy
   finalised, OpenAPI snapshot).
6. `docs: fork maintenance guide` (`FORK.md`, README pointer).
7. Image build + push; k8s-config commit (separate repo).

## Follow-ups

- Memoize the calendar stage of `getCountdownBreakdown` per minute (see the per-tick cost invariant
  above); not implemented.
