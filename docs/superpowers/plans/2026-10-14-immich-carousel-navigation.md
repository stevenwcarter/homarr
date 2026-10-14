# Immich Carousel Navigation, Stable Order, Photo Fit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Immich Album carousel optional side arrows, a random order that survives refetches, a `fit` photo mode with blur or solid-colour backdrop, and slideshow state that survives edit mode and reloads.

**Architecture:** Pure ordering and state helpers in new files under the widget folder; a `PhotoStage` and `CarouselNavigation` component; the existing `component.tsx` wires them with a sessionStorage-backed state record. A new shared `color` option type (factory + input) provides the colour picker.

**Tech Stack:** TypeScript, React 19, Mantine 9 (`ColorInput`, `ActionIcon`, `Image`), zod v4 (`zod`), vitest (`dom` project, run from repo root), Playwright e2e via testcontainers.

**Spec:** `docs/superpowers/specs/2026-10-14-immich-carousel-navigation-design.md`

## Global Constraints

- Branch `countdown-display`; commit prefixes `feat(immich):` for widget files, `feat(widgets):` for shared option/input/hook files, `test(e2e):`, `docs(fork):`. Each commit touches only files listed in its task.
- Run unit tests from the repo root: `bun x vitest run --project dom <paths>`. Running inside `packages/widgets` fails (missing `vitest.setup.ts`).
- `packages/widgets/src/test/translation.spec.ts` has one pre-existing failure (`rssFeed descriptionMaxLength`); `packages/widgets/src/rssFeed/component.tsx` is not oxfmt-clean. Both are upstream dirt; do not fix, do not count as new failures.
- Format with `bun x oxfmt <files>`, lint with `bun x oxlint <files>`. Typecheck: `cd packages/widgets && bun x tsc --noEmit -p tsconfig.json`.
- Mantine `Image` is used for the photo; `ColorInput` is imported from `@mantine/core`.
- No new dependencies.
- `.superpowers/sdd/**` is never deleted.

## Review Focus

1. Random order must not change when the album refetches with the same ids. Pinned in Task 1 (`orderAssets` same-seed test) and Task 6 (component derives order from stored seed, never `Math.random` in render).
2. An arrow click while paused must leave the slideshow paused. Pinned in Task 6's reducer-style `moveBy` not touching `paused`, and in the e2e edit-mode round trip (Task 7).
3. Leaving edit mode must show the same photo. Pinned by Task 7 e2e step 4.
4. The colour input must reject non-hex values on save. Pinned by Task 3's `hexColorSchema` tests.
5. A stored `currentAssetId` that no longer exists must fall back to the first photo, not crash. Pinned by Task 1's `resolveCurrentIndex` test.

---

### Task 1: Pure ordering and slideshow-state helpers

**Files:**
- Create: `packages/widgets/src/immich/album-carousel/order.ts`
- Create: `packages/widgets/src/immich/album-carousel/order.spec.ts`
- Create: `packages/widgets/src/immich/album-carousel/slideshow-state.ts`
- Create: `packages/widgets/src/immich/album-carousel/slideshow-state.spec.ts`

**Interfaces:**
- Produces: `createOrderSeed(): number`, `rankAsset(seed: number, assetId: string): number`, `orderAssets<T extends { id: string }>(assets: readonly T[], options: { randomize: boolean; seed: number; firstAssetId?: string | null }): T[]`, `resolveCurrentIndex(assets: readonly { id: string }[], currentAssetId: string | null): number`, `stepAssetId(assets: readonly { id: string }[], currentAssetId: string | null, offset: number): string | null`.
- Produces: `interface SlideshowState { seed: number; currentAssetId: string | null; paused: boolean }`, `SLIDESHOW_STATE_VERSION = 1`, `isSlideshowState(value: unknown): value is SlideshowState`, `createSlideshowState(): SlideshowState`, `getSlideshowStateKey(boardId: string | undefined, itemId: string | undefined): string | undefined`.

- [ ] **Step 1: Write the failing tests**

`packages/widgets/src/immich/album-carousel/order.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createOrderSeed, orderAssets, rankAsset, resolveCurrentIndex, stepAssetId } from "./order";

const asset = (id: string) => ({ id });
const ids = (items: { id: string }[]) => items.map((item) => item.id);
const album = ["a", "b", "c", "d", "e", "f", "g", "h"].map(asset);

describe("rankAsset", () => {
  it("is deterministic for the same seed and id", () => {
    expect(rankAsset(42, "photo-1")).toBe(rankAsset(42, "photo-1"));
  });

  it("differs between seeds and between ids", () => {
    expect(rankAsset(42, "photo-1")).not.toBe(rankAsset(43, "photo-1"));
    expect(rankAsset(42, "photo-1")).not.toBe(rankAsset(42, "photo-2"));
  });

  it("returns a non-negative 32-bit integer", () => {
    const rank = rankAsset(7, "x");
    expect(Number.isInteger(rank)).toBe(true);
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("createOrderSeed", () => {
  it("returns a non-negative 32-bit integer", () => {
    const seed = createOrderSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("orderAssets", () => {
  it("keeps album order when not randomizing", () => {
    expect(ids(orderAssets(album, { randomize: false, seed: 1 }))).toEqual(ids(album));
  });

  it("produces a permutation that differs from album order for a seed", () => {
    const ordered = orderAssets(album, { randomize: true, seed: 12345 });
    expect([...ids(ordered)].sort()).toEqual([...ids(album)].sort());
    expect(ids(ordered)).not.toEqual(ids(album));
  });

  it("returns the same order for the same seed regardless of input order", () => {
    const shuffledInput = [album[3]!, album[0]!, album[7]!, album[1]!, album[5]!, album[2]!, album[6]!, album[4]!];
    expect(ids(orderAssets(shuffledInput, { randomize: true, seed: 99 }))).toEqual(
      ids(orderAssets(album, { randomize: true, seed: 99 })),
    );
  });

  it("differs between seeds", () => {
    expect(ids(orderAssets(album, { randomize: true, seed: 1 }))).not.toEqual(
      ids(orderAssets(album, { randomize: true, seed: 2 })),
    );
  });

  it("keeps the relative order of existing photos when one is added or removed", () => {
    const base = ids(orderAssets(album, { randomize: true, seed: 5 }));
    const withExtra = ids(orderAssets([...album, asset("z")], { randomize: true, seed: 5 })).filter((id) => id !== "z");
    const withoutC = ids(orderAssets(album.filter((item) => item.id !== "c"), { randomize: true, seed: 5 }));
    expect(withExtra).toEqual(base);
    expect(withoutC).toEqual(base.filter((id) => id !== "c"));
  });

  it("moves the preview photo to the front", () => {
    const ordered = ids(orderAssets(album, { randomize: true, seed: 5, firstAssetId: "f" }));
    expect(ordered[0]).toBe("f");
    expect([...ordered].sort()).toEqual([...ids(album)].sort());
  });

  it("ignores a preview photo that is not in the album", () => {
    expect(ids(orderAssets(album, { randomize: true, seed: 5, firstAssetId: "missing" }))).toEqual(
      ids(orderAssets(album, { randomize: true, seed: 5 })),
    );
  });
});

describe("resolveCurrentIndex", () => {
  it("returns the index of the current asset", () => {
    expect(resolveCurrentIndex(album, "c")).toBe(2);
  });

  it("falls back to 0 for null, missing ids, and empty lists", () => {
    expect(resolveCurrentIndex(album, null)).toBe(0);
    expect(resolveCurrentIndex(album, "missing")).toBe(0);
    expect(resolveCurrentIndex([], "a")).toBe(0);
  });
});

describe("stepAssetId", () => {
  it("steps forward and backward with wrap-around", () => {
    expect(stepAssetId(album, "a", 1)).toBe("b");
    expect(stepAssetId(album, "h", 1)).toBe("a");
    expect(stepAssetId(album, "a", -1)).toBe("h");
    expect(stepAssetId(album, "d", -2)).toBe("b");
  });

  it("starts from the first photo when the current id is unknown", () => {
    expect(stepAssetId(album, null, 1)).toBe("b");
    expect(stepAssetId(album, "missing", -1)).toBe("h");
  });

  it("returns null for an empty list", () => {
    expect(stepAssetId([], "a", 1)).toBeNull();
  });
});
```

`packages/widgets/src/immich/album-carousel/slideshow-state.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createSlideshowState, getSlideshowStateKey, isSlideshowState } from "./slideshow-state";

describe("isSlideshowState", () => {
  it("accepts a well-formed record", () => {
    expect(isSlideshowState({ seed: 12, currentAssetId: "a", paused: true })).toBe(true);
    expect(isSlideshowState({ seed: 0, currentAssetId: null, paused: false })).toBe(true);
  });

  it("rejects missing fields, wrong types, and non-integer seeds", () => {
    expect(isSlideshowState(null)).toBe(false);
    expect(isSlideshowState({ seed: 12, paused: true })).toBe(false);
    expect(isSlideshowState({ seed: "12", currentAssetId: null, paused: false })).toBe(false);
    expect(isSlideshowState({ seed: 1.5, currentAssetId: null, paused: false })).toBe(false);
    expect(isSlideshowState({ seed: 1, currentAssetId: 3, paused: false })).toBe(false);
    expect(isSlideshowState({ seed: 1, currentAssetId: null, paused: "no" })).toBe(false);
  });
});

describe("createSlideshowState", () => {
  it("starts unpaused at no photo with an integer seed", () => {
    const state = createSlideshowState();
    expect(state.currentAssetId).toBeNull();
    expect(state.paused).toBe(false);
    expect(Number.isInteger(state.seed)).toBe(true);
    expect(isSlideshowState(state)).toBe(true);
  });
});

describe("getSlideshowStateKey", () => {
  it("builds a key from board and item", () => {
    expect(getSlideshowStateKey("board1", "item1")).toBe("homarr:immich-albumCarousel:board1:item1:slideshow");
  });

  it("is undefined without a board or item", () => {
    expect(getSlideshowStateKey(undefined, "item1")).toBeUndefined();
    expect(getSlideshowStateKey("board1", undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun x vitest run --project dom packages/widgets/src/immich/album-carousel/`
Expected: both files fail with "Cannot find module './order'" / "'./slideshow-state'".

- [ ] **Step 3: Implement `order.ts`**

```ts
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Deterministic 32-bit rank of an asset for a seed; the same inputs always give the same rank. */
export const rankAsset = (seed: number, assetId: string): number => {
  let hash = (FNV_OFFSET ^ (seed >>> 0)) >>> 0;
  for (let index = 0; index < assetId.length; index += 1) {
    hash ^= assetId.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  // mulberry32 finalizer to spread the bits.
  hash = (hash + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(hash ^ (hash >>> 15), 1 | hash);
  mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
  return (mixed ^ (mixed >>> 14)) >>> 0;
};

export const createOrderSeed = (): number => Math.floor(Math.random() * 0x100000000);

interface OrderOptions {
  randomize: boolean;
  seed: number;
  firstAssetId?: string | null;
}

/** Album order, or a seeded order in which each photo's position depends only on the seed and its own id. */
export const orderAssets = <T extends { id: string }>(assets: readonly T[], options: OrderOptions): T[] => {
  let ordered = [...assets];
  if (options.randomize) {
    const ranks = new Map(assets.map((asset) => [asset.id, rankAsset(options.seed, asset.id)]));
    // oxlint-disable-next-line unicorn/no-array-sort -- Array.toSorted is not supported in all target browsers.
    ordered.sort((left, right) => {
      const difference = (ranks.get(left.id) ?? 0) - (ranks.get(right.id) ?? 0);
      return difference !== 0 ? difference : left.id.localeCompare(right.id);
    });
  }
  const firstAssetId = options.firstAssetId;
  if (firstAssetId) {
    const first = ordered.find((asset) => asset.id === firstAssetId);
    if (first) ordered = [first, ...ordered.filter((asset) => asset.id !== firstAssetId)];
  }
  return ordered;
};

export const resolveCurrentIndex = (assets: readonly { id: string }[], currentAssetId: string | null): number => {
  if (currentAssetId === null) return 0;
  const index = assets.findIndex((asset) => asset.id === currentAssetId);
  return index === -1 ? 0 : index;
};

export const stepAssetId = (
  assets: readonly { id: string }[],
  currentAssetId: string | null,
  offset: number,
): string | null => {
  if (assets.length === 0) return null;
  const index = resolveCurrentIndex(assets, currentAssetId);
  const next = (((index + offset) % assets.length) + assets.length) % assets.length;
  return assets[next]?.id ?? null;
};
```

- [ ] **Step 4: Implement `slideshow-state.ts`**

```ts
import { createOrderSeed } from "./order";

export interface SlideshowState {
  seed: number;
  currentAssetId: string | null;
  paused: boolean;
}

export const SLIDESHOW_STATE_VERSION = 1;

export const isSlideshowState = (value: unknown): value is SlideshowState => {
  if (typeof value !== "object" || value === null) return false;
  if (!("seed" in value) || !("currentAssetId" in value) || !("paused" in value)) return false;
  const { seed, currentAssetId, paused } = value as Record<string, unknown>;
  return (
    typeof seed === "number" &&
    Number.isInteger(seed) &&
    (currentAssetId === null || typeof currentAssetId === "string") &&
    typeof paused === "boolean"
  );
};

export const createSlideshowState = (): SlideshowState => ({
  seed: createOrderSeed(),
  currentAssetId: null,
  paused: false,
});

export const getSlideshowStateKey = (boardId: string | undefined, itemId: string | undefined) =>
  boardId && itemId ? `homarr:immich-albumCarousel:${boardId}:${itemId}:slideshow` : undefined;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun x vitest run --project dom packages/widgets/src/immich/album-carousel/`
Expected: all pass. If "differs from album order" or "differs between seeds" fails, the hash is degenerate; do not weaken the test, fix the hash.

- [ ] **Step 6: Lint, format, commit**

```bash
bun x oxfmt packages/widgets/src/immich/album-carousel/order.ts packages/widgets/src/immich/album-carousel/order.spec.ts packages/widgets/src/immich/album-carousel/slideshow-state.ts packages/widgets/src/immich/album-carousel/slideshow-state.spec.ts
bun x oxlint packages/widgets/src/immich/album-carousel
git add packages/widgets/src/immich/album-carousel/order.ts packages/widgets/src/immich/album-carousel/order.spec.ts packages/widgets/src/immich/album-carousel/slideshow-state.ts packages/widgets/src/immich/album-carousel/slideshow-state.spec.ts
git commit -m "feat(immich): seeded photo order and slideshow state helpers"
```

---

### Task 2: Session storage option for `useLocalWidgetState`

**Files:**
- Modify: `packages/widgets/src/common/use-local-widget-state.ts`
- Modify: `packages/widgets/src/common/use-local-widget-state.spec.ts`

**Interfaces:**
- Produces: `UseLocalWidgetStateOptions.storage?: "local" | "session"` (default `"local"`); exported `resolveWidgetStateStorage(storage?: "local" | "session"): Storage`.
- Existing callers (`countdown/component.tsx`) unchanged.

- [ ] **Step 1: Write the failing test**

Append to `use-local-widget-state.spec.ts` (add `resolveWidgetStateStorage` to the import line):

```ts
describe("resolveWidgetStateStorage", () => {
  it("returns session storage for 'session' and local storage otherwise", () => {
    expect(resolveWidgetStateStorage("session")).toBe(window.sessionStorage);
    expect(resolveWidgetStateStorage("local")).toBe(window.localStorage);
    expect(resolveWidgetStateStorage(undefined)).toBe(window.localStorage);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun x vitest run --project dom packages/widgets/src/common/use-local-widget-state.spec.ts`
Expected: FAIL, `resolveWidgetStateStorage` is not exported.

- [ ] **Step 3: Implement**

In `use-local-widget-state.ts`:

1. Add to `UseLocalWidgetStateOptions<T>`: `storage?: WidgetStateStorage;` and above the interface:

```ts
export type WidgetStateStorage = "local" | "session";

export const resolveWidgetStateStorage = (storage?: WidgetStateStorage): Storage =>
  storage === "session" ? window.sessionStorage : window.localStorage;
```

2. Destructure `storage` in the hook signature. Inside the hook, every `window.localStorage` reference becomes `resolveWidgetStateStorage(storage)`:
   - `removeStoredValue`: `resolveWidgetStateStorage(storage).removeItem(key)`; add `storage` to its deps.
   - Read effect: `const serialized = resolveWidgetStateStorage(storage).getItem(key)` and the `removeItem` inside it; add `storage` to deps.
   - Storage event effect: `if (event.storageArea !== resolveWidgetStateStorage(storage) || event.key !== key) return;`; add `storage` to deps.
   - `setValue`: `resolveWidgetStateStorage(storage).setItem(...)`; add `storage` to deps.

Do not call `resolveWidgetStateStorage` during render outside those callbacks/effects (it touches `window`).

- [ ] **Step 4: Run the tests and the countdown widget's tests**

Run: `bun x vitest run --project dom packages/widgets/src/common/use-local-widget-state.spec.ts packages/widgets/src/countdown`
Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
cd packages/widgets && bun x tsc --noEmit -p tsconfig.json && cd ../..
bun x oxfmt packages/widgets/src/common/use-local-widget-state.ts packages/widgets/src/common/use-local-widget-state.spec.ts
git add packages/widgets/src/common/use-local-widget-state.ts packages/widgets/src/common/use-local-widget-state.spec.ts
git commit -m "feat(widgets): session storage option for useLocalWidgetState"
```

---

### Task 3: Shared `color` option type

**Files:**
- Modify: `packages/widgets/src/options.ts`
- Create: `packages/widgets/src/options.spec.ts` (if one already exists, append)
- Create: `packages/widgets/src/_inputs/widget-color-input.tsx`
- Modify: `packages/widgets/src/_inputs/index.ts`

**Interfaces:**
- Produces: `optionsFactory.color(input?: CommonInput<string>)` → `{ type: "color"; defaultValue: string; withDescription: boolean; validate: ZodType }`; exported `hexColorSchema`.
- `WidgetOptionType` gains `"color"` automatically (derived from the factory).

- [ ] **Step 1: Write the failing test**

`packages/widgets/src/options.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { hexColorSchema, optionsBuilder } from "./options";

describe("hexColorSchema", () => {
  it("accepts six-digit hex colours", () => {
    expect(hexColorSchema.safeParse("#336699").success).toBe(true);
    expect(hexColorSchema.safeParse("#AbCdEf").success).toBe(true);
  });

  it("rejects everything else", () => {
    for (const value of ["336699", "#36", "red", "#33669", "#3366999", ""]) {
      expect(hexColorSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("color option", () => {
  it("defaults to black with the hex validator", () => {
    const options = optionsBuilder.from((factory) => ({ tint: factory.color() }));
    expect(options.tint.type).toBe("color");
    expect(options.tint.defaultValue).toBe("#000000");
    expect(options.tint.validate).toBe(hexColorSchema);
  });

  it("accepts a default value", () => {
    const options = optionsBuilder.from((factory) => ({ tint: factory.color({ defaultValue: "#336699" }) }));
    expect(options.tint.defaultValue).toBe("#336699");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun x vitest run --project dom packages/widgets/src/options.spec.ts`
Expected: FAIL, `hexColorSchema` not exported / `factory.color` is not a function.

- [ ] **Step 3: Add the factory entry**

In `options.ts`, near the top (after the existing imports; `z` is already imported):

```ts
export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
```

In `optionsFactory`, after `text`:

```ts
  color: (input?: CommonInput<string>) => ({
    type: "color" as const,
    defaultValue: input?.defaultValue ?? "#000000",
    withDescription: input?.withDescription ?? false,
    validate: hexColorSchema,
  }),
```

- [ ] **Step 4: Create the input component**

`packages/widgets/src/_inputs/widget-color-input.tsx`:

```tsx
"use client";

import { ColorInput } from "@mantine/core";

import type { CommonWidgetInputProps } from "./common";
import { useWidgetInputTranslation } from "./common";
import { useFormContext } from "./form";

const swatches = ["#000000", "#1a1b1e", "#2e2e2e", "#495057", "#868e96", "#dee2e6", "#f8f9fa", "#ffffff"];

export const WidgetColorInput = ({ property, kind, options }: CommonWidgetInputProps<"color">) => {
  const t = useWidgetInputTranslation(kind, property);
  const form = useFormContext();

  return (
    <ColorInput
      label={t("label")}
      description={options.withDescription ? t("description") : undefined}
      format="hex"
      swatches={swatches}
      swatchesPerRow={8}
      {...form.getInputProps(`options.${property}`)}
    />
  );
};
```

- [ ] **Step 5: Register it**

In `_inputs/index.ts`: add `import { WidgetColorInput } from "./widget-color-input";` and `color: WidgetColorInput,` to `mapping` (after `text`).

- [ ] **Step 6: Check for other exhaustive switches**

Run: `grep -rn "satisfies Record<WidgetOptionType" packages apps --include=*.ts --include=*.tsx | grep -v node_modules` and `cd packages/widgets && bun x tsc --noEmit -p tsconfig.json`. If typecheck reports a missing `color` case anywhere (for example a context-menu or custom-widget mapping), add a `color` branch that mirrors the `text` branch. Note what you found in the report.

- [ ] **Step 7: Run the tests, typecheck, format, lint, commit**

```bash
bun x vitest run --project dom packages/widgets/src/options.spec.ts
cd packages/widgets && bun x tsc --noEmit -p tsconfig.json && cd ../..
bun x oxfmt packages/widgets/src/options.ts packages/widgets/src/options.spec.ts packages/widgets/src/_inputs/widget-color-input.tsx packages/widgets/src/_inputs/index.ts
bun x oxlint packages/widgets/src/options.ts packages/widgets/src/_inputs
git add packages/widgets/src/options.ts packages/widgets/src/options.spec.ts packages/widgets/src/_inputs/widget-color-input.tsx packages/widgets/src/_inputs/index.ts
git commit -m "feat(widgets): color option type with hex validation"
```

---

### Task 4: Widget options, translations, docs

**Files:**
- Modify: `packages/widgets/src/immich/album-carousel/index.ts`
- Modify: `packages/translation/src/lang/en.json` (`widget.immich-albumCarousel`)
- Modify: `apps/docs/docs/widgets/immich-album-carousel/index.ts`
- Modify: `apps/docs/docs/widgets/immich-album-carousel/index.mdx`

**Interfaces:**
- Consumes: `factory.color` (Task 3).
- Produces: options `showNavigationArrows: boolean`, `photoFit: "cover" | "fit"`, `backdrop: "blur" | "color"`, `backdropColor: string` on `WidgetComponentProps<"immich-albumCarousel">["options"]`.

- [ ] **Step 1: Add the options**

In `index.ts`, inside `optionsBuilder.from((factory) => ({ ... }))` after `randomizePhotos`:

```ts
    showNavigationArrows: factory.switch({
      defaultValue: false,
      withDescription: true,
    }),
    photoFit: factory.select({
      defaultValue: "cover",
      options: [
        { value: "cover", label: (t) => t("widget.immich-albumCarousel.photoFit.cover") },
        { value: "fit", label: (t) => t("widget.immich-albumCarousel.photoFit.fit") },
      ],
      withDescription: true,
    }),
    backdrop: factory.select({
      defaultValue: "blur",
      options: [
        { value: "blur", label: (t) => t("widget.immich-albumCarousel.backdrop.blur") },
        { value: "color", label: (t) => t("widget.immich-albumCarousel.backdrop.color") },
      ],
      withDescription: true,
    }),
    backdropColor: factory.color({
      defaultValue: "#000000",
      withDescription: true,
    }),
```

and pass a second argument to `optionsBuilder.from` (the field configuration), following `packages/widgets/src/clock/index.ts`:

```ts
  }), {
    backdropColor: {
      shouldHide: (options) => options.backdrop !== "color",
    },
  });
```

- [ ] **Step 2: Translations**

In `en.json` under `widget` → `"immich-albumCarousel"`:

Inside `option`, after `randomizePhotos`:

```json
        "showNavigationArrows": {
          "label": "Navigation arrows",
          "description": "Show previous and next arrows on the sides of the photo while the pointer is over the widget."
        },
        "photoFit": {
          "label": "Photo fit",
          "description": "Cover fills the tile and crops the photo. Fit shows the whole photo and fills the rest with the backdrop."
        },
        "backdrop": {
          "label": "Backdrop",
          "description": "What fills the space around a fitted photo and behind the focus view: a blurred copy of the photo, or a solid colour."
        },
        "backdropColor": {
          "label": "Backdrop colour",
          "description": "Solid colour shown around the photo when the backdrop is set to colour."
        }
```

As siblings of `option` (after `actions`):

```json
      "photoFit": { "cover": "Cover", "fit": "Fit" },
      "backdrop": { "blur": "Blurred photo", "color": "Solid colour" }
```

Validate with `node -e 'require("./packages/translation/src/lang/en.json")'`.

- [ ] **Step 3: Docs**

`apps/docs/docs/widgets/immich-album-carousel/index.ts`, append to `configuration.items`:

```ts
      {
        name: "Navigation arrows",
        description: "Show previous and next arrows on the sides of the photo while the pointer is over the widget.",
        values: { type: "boolean" },
        defaultValue: "no",
      },
      {
        name: "Photo fit",
        description: "Cover fills the tile and crops the photo. Fit shows the whole photo and fills the rest with the backdrop.",
        values: { type: "string" },
        defaultValue: "Cover",
      },
      {
        name: "Backdrop",
        description: "What fills the space around a fitted photo and behind the focus view: a blurred copy of the photo, or a solid colour.",
        values: { type: "string" },
        defaultValue: "Blurred photo",
      },
      {
        name: "Backdrop colour",
        description: "Solid colour shown around the photo when the backdrop is set to colour.",
        values: { type: "string" },
        defaultValue: "#000000",
      },
```

`index.mdx`: replace the sentence "The advanced view displays the complete photo without cropping, groups previous, pause or resume, and next together, and includes every loaded photo in its thumbnail strip." with:

"The advanced view displays the complete photo without cropping over the chosen backdrop, keeps pause or resume in its corner, and includes every loaded photo in its thumbnail strip. With navigation arrows enabled, previous and next appear on the sides of the photo in both views while the pointer is over the widget; otherwise the advanced view groups previous, pause or resume, and next together."

Replace "If randomization is enabled, the preview photo stays first and the remaining photos are shuffled." with:

"If randomization is enabled, the preview photo stays first and the remaining photos follow a random order that stays the same while the tab is open. The current photo and the paused state are also kept while the tab is open, including across edit mode."

- [ ] **Step 4: Verify translations and typecheck**

Run: `bun x vitest run --project dom packages/widgets/src/test/translation.spec.ts`
Expected: only the pre-existing `rssFeed descriptionMaxLength` failure; all `immich-albumCarousel` cases pass.

Run: `cd packages/widgets && bun x tsc --noEmit -p tsconfig.json`. Expected: clean. (`component.tsx` does not read the new options yet; that is fine.)

- [ ] **Step 5: Format, commit**

```bash
bun x oxfmt packages/widgets/src/immich/album-carousel/index.ts packages/translation/src/lang/en.json apps/docs/docs/widgets/immich-album-carousel/index.ts apps/docs/docs/widgets/immich-album-carousel/index.mdx
git add packages/widgets/src/immich/album-carousel/index.ts packages/translation/src/lang/en.json apps/docs/docs/widgets/immich-album-carousel/index.ts apps/docs/docs/widgets/immich-album-carousel/index.mdx
git commit -m "feat(immich): arrows, photo fit, and backdrop options"
```

---

### Task 5: Photo stage and navigation components

**Files:**
- Create: `packages/widgets/src/immich/album-carousel/photo-stage.tsx`
- Create: `packages/widgets/src/immich/album-carousel/navigation.tsx`
- Modify: `packages/widgets/src/immich/album-carousel/component.module.css`
- Create: `packages/widgets/src/immich/album-carousel/photo-stage.spec.tsx`

**Interfaces:**
- Produces: `PhotoStage({ src, alt, fit: "cover" | "fit", backdrop: "blur" | "color", backdropColor: string, assetId: string })` → fills parent; root has `data-asset-id`, `data-fit`, `data-backdrop`; blur layer has `data-backdrop-layer="blur"`.
- Produces: `CarouselNavigation({ onPrevious, onNext }: { onPrevious: () => void; onNext: () => void })`; buttons carry `data-carousel-nav="previous" | "next"`.

- [ ] **Step 1: Write the failing test**

`photo-stage.spec.tsx` (mock Mantine `Image` to a plain `img`, as `countdown-display/tiles.spec.tsx` mocks Mantine):

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mantine/core", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Image: ({ src, alt, className, ...rest }: any) => <img src={src} alt={alt} className={className} {...rest} />,
}));

import { PhotoStage } from "./photo-stage";

const props = { src: "https://example.test/p.jpg", alt: "Album photo", assetId: "p1", backdropColor: "#336699" };

describe("PhotoStage", () => {
  it("renders cover without a backdrop layer", () => {
    const { container } = render(<PhotoStage {...props} fit="cover" backdrop="blur" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.assetId).toBe("p1");
    expect(root.dataset.fit).toBe("cover");
    expect(container.querySelector('[data-backdrop-layer="blur"]')).toBeNull();
    expect(root.style.backgroundColor).toBe("");
  });

  it("renders a blurred copy behind a fitted photo", () => {
    const { container } = render(<PhotoStage {...props} fit="fit" backdrop="blur" />);
    const layer = container.querySelector<HTMLImageElement>('[data-backdrop-layer="blur"]');
    expect(layer?.getAttribute("src")).toBe(props.src);
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("renders a solid colour behind a fitted photo", () => {
    const { container } = render(<PhotoStage {...props} fit="fit" backdrop="color" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.backdrop).toBe("color");
    expect(root.style.backgroundColor).toBe("rgb(51, 102, 153)");
    expect(container.querySelector('[data-backdrop-layer="blur"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun x vitest run --project dom packages/widgets/src/immich/album-carousel/photo-stage.spec.tsx`
Expected: FAIL, cannot find `./photo-stage`.

- [ ] **Step 3: Implement `photo-stage.tsx`**

```tsx
"use client";

import { Image } from "@mantine/core";

import classes from "./component.module.css";

export type PhotoFit = "cover" | "fit";
export type PhotoBackdrop = "blur" | "color";

interface PhotoStageProps {
  src: string;
  alt: string;
  fit: PhotoFit;
  backdrop: PhotoBackdrop;
  backdropColor: string;
  assetId: string;
}

export const PhotoStage = ({ src, alt, fit, backdrop, backdropColor, assetId }: PhotoStageProps) => {
  const fitted = fit === "fit";
  return (
    <div
      className={classes.stage}
      data-asset-id={assetId}
      data-fit={fit}
      data-backdrop={fitted ? backdrop : undefined}
      style={fitted && backdrop === "color" ? { backgroundColor: backdropColor } : undefined}
    >
      {fitted && backdrop === "blur" && (
        <img src={src} alt="" aria-hidden="true" className={classes.backdropBlur} data-backdrop-layer="blur" />
      )}
      <Image src={src} alt={alt} className={classes.carouselImage} data-fit={fitted ? "contain" : "cover"} />
    </div>
  );
};
```

- [ ] **Step 4: Implement `navigation.tsx`**

```tsx
"use client";

import type { MouseEvent } from "react";
import { ActionIcon } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import { useI18n } from "@homarr/translation/client";

import classes from "./component.module.css";

interface CarouselNavigationProps {
  onPrevious: () => void;
  onNext: () => void;
}

export const CarouselNavigation = ({ onPrevious, onNext }: CarouselNavigationProps) => {
  const t = useI18n("widget.immich-albumCarousel");
  const handle = (action: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    action();
  };

  return (
    <>
      <ActionIcon
        aria-label={t("actions.previousPhoto")}
        variant="filled"
        color="dark"
        radius="xl"
        size={40}
        className={classes.navArrow}
        data-carousel-nav="previous"
        onClick={handle(onPrevious)}
      >
        <IconChevronLeft size="var(--mantine-font-size-lg)" />
      </ActionIcon>
      <ActionIcon
        aria-label={t("actions.nextPhoto")}
        variant="filled"
        color="dark"
        radius="xl"
        size={40}
        className={classes.navArrow}
        data-carousel-nav="next"
        onClick={handle(onNext)}
      >
        <IconChevronRight size="var(--mantine-font-size-lg)" />
      </ActionIcon>
    </>
  );
};
```

- [ ] **Step 5: CSS**

Append to `component.module.css`:

```css
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--mantine-color-gray-8);
}

.stage .carouselImage {
  position: relative;
  z-index: 1;
}

.stage[data-fit="fit"] .carouselImage {
  background-color: transparent;
}

.backdropBlur {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.15);
  filter: blur(24px) brightness(0.7);
  pointer-events: none;
}

.navArrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.navArrow[data-carousel-nav="previous"] {
  inset-inline-start: 8px;
}

.navArrow[data-carousel-nav="next"] {
  inset-inline-end: 8px;
}

.carouselContainer:hover .navArrow,
.carouselContainer:focus-within .navArrow {
  opacity: 1;
  pointer-events: auto;
}

@media (any-pointer: coarse) {
  .navArrow {
    opacity: 1;
    pointer-events: auto;
    width: 44px;
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .navArrow {
    transition: none;
  }
}
```

Also change the existing `.carouselImage[data-fit="contain"]` rule so it no longer forces a black background when inside a stage: replace `background-color: var(--mantine-color-black);` with `background-color: transparent;` in that rule. (The stage, blur layer or colour supplies the background now.)

- [ ] **Step 6: Run the test, typecheck, lint, format, commit**

```bash
bun x vitest run --project dom packages/widgets/src/immich/album-carousel/photo-stage.spec.tsx
cd packages/widgets && bun x tsc --noEmit -p tsconfig.json && cd ../..
bun x oxfmt packages/widgets/src/immich/album-carousel/photo-stage.tsx packages/widgets/src/immich/album-carousel/photo-stage.spec.tsx packages/widgets/src/immich/album-carousel/navigation.tsx packages/widgets/src/immich/album-carousel/component.module.css
bun x oxlint packages/widgets/src/immich/album-carousel
git add packages/widgets/src/immich/album-carousel/photo-stage.tsx packages/widgets/src/immich/album-carousel/photo-stage.spec.tsx packages/widgets/src/immich/album-carousel/navigation.tsx packages/widgets/src/immich/album-carousel/component.module.css
git commit -m "feat(immich): photo stage with blur or colour backdrop and side navigation"
```

---

### Task 6: Wire the carousel component

**Files:**
- Modify: `packages/widgets/src/immich/album-carousel/component.tsx`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 `storage: "session"`, Task 4 options, Task 5 components.
- The context actions in `index.ts` (`previousPhoto`, `nextPhoto`, `toggleSlideshow`) keep their names.

- [ ] **Step 1: Replace `component.tsx`**

Write the file as below. It keeps the queries, preview handoff, empty states, thumbnail strip and photo info unchanged, and replaces the index state, shuffle, and image rendering.

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Box, Center, Group, Image, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";

import { clientApi } from "@homarr/api/client";
import { useCurrentIntlLocale, useI18n } from "@homarr/translation/client";
import { iconSizes } from "@homarr/ui";

import { WidgetEmptyState } from "../../common/empty-state";
import { useLocalWidgetState } from "../../common/use-local-widget-state";
import type { WidgetComponentProps } from "../../definition";
import { useWidgetRuntimeActions } from "../../runtime-hooks";
import { getUsableWidgetQueryData } from "../../common/query-state";
import classes from "./component.module.css";
import { ALL_PHOTOS_ALBUM_ID } from "./constants";
import { CarouselNavigation } from "./navigation";
import { orderAssets, resolveCurrentIndex, stepAssetId } from "./order";
import type { PhotoBackdrop, PhotoFit } from "./photo-stage";
import { PhotoStage } from "./photo-stage";
import type { SlideshowState } from "./slideshow-state";
import { createSlideshowState, getSlideshowStateKey, isSlideshowState, SLIDESHOW_STATE_VERSION } from "./slideshow-state";

export default function ImmichAlbumCarouselWidget({
  integrationIds,
  options,
  displayMode = "compact",
  widgetRuntimeRef,
  boardId,
  itemId,
}: WidgetComponentProps<"immich-albumCarousel">) {
  const [slideshow, setSlideshow] = useLocalWidgetState<SlideshowState>({
    key: getSlideshowStateKey(boardId, itemId),
    storage: "session",
    version: SLIDESHOW_STATE_VERSION,
    defaultValue: createSlideshowState,
    validate: isSlideshowState,
  });
  const [firstPreviewPhoto, setFirstPreviewPhoto] = useState<{ albumId: string; assetId: string } | null>(null);
  let albumId: string | undefined;
  if (options.albumId && options.albumId !== ALL_PHOTOS_ALBUM_ID) albumId = options.albumId;
  const integrationId = integrationIds[0] ?? "";

  const albumQuery = clientApi.widget.immich.getAlbum.useQuery(
    { integrationId, albumId },
    { enabled: integrationIds.length > 0 },
  );
  const previewQuery = clientApi.widget.immich.getAlbumPreview.useQuery(
    { integrationId, albumId: albumId ?? "", randomizePhotos: options.randomizePhotos },
    { enabled: integrationIds.length > 0 && albumId !== undefined },
  );
  const fullAlbum = getUsableWidgetQueryData(albumQuery);
  const preview = previewQuery.data;
  const album = fullAlbum ?? preview;

  useEffect(() => {
    const asset = preview?.assets[0];
    if (!albumId || !asset || fullAlbum || firstPreviewPhoto?.albumId === albumId) return;
    setFirstPreviewPhoto({ albumId, assetId: asset.id });
  }, [albumId, firstPreviewPhoto?.albumId, fullAlbum, preview?.assets]);

  const photoAssets = useMemo(() => {
    const assets = album?.assets.filter((asset) => asset.type === "IMAGE") ?? [];
    const firstAssetId =
      options.randomizePhotos && fullAlbum && firstPreviewPhoto && firstPreviewPhoto.albumId === albumId
        ? firstPreviewPhoto.assetId
        : null;
    return orderAssets(assets, { randomize: options.randomizePhotos, seed: slideshow.seed, firstAssetId });
  }, [album?.assets, albumId, firstPreviewPhoto, fullAlbum, options.randomizePhotos, slideshow.seed]);

  const setCurrentAssetId = useCallback(
    (currentAssetId: string | null) => setSlideshow((current) => ({ ...current, currentAssetId })),
    [setSlideshow],
  );
  const moveBy = useCallback(
    (offset: number) =>
      setSlideshow((current) => ({
        ...current,
        currentAssetId: stepAssetId(photoAssets, current.currentAssetId, offset),
      })),
    [photoAssets, setSlideshow],
  );
  const previousPhoto = useCallback(() => moveBy(-1), [moveBy]);
  const nextPhoto = useCallback(() => moveBy(1), [moveBy]);
  const setPaused = useCallback(
    (paused: boolean) => setSlideshow((current) => (current.paused === paused ? current : { ...current, paused })),
    [setSlideshow],
  );
  const toggleSlideshow = useCallback(
    () => setSlideshow((current) => ({ ...current, paused: !current.paused })),
    [setSlideshow],
  );
  useWidgetRuntimeActions(
    widgetRuntimeRef,
    photoAssets.length > 1 ? { previousPhoto, nextPhoto, toggleSlideshow } : {},
  );

  if (!album || (!fullAlbum && album.assets.length === 0)) return <WidgetEmptyState />;

  return (
    <Box h="100%" pos="relative">
      {album.assets.length === 0 || photoAssets.length === 0 ? (
        <NoPhotosInAlbum />
      ) : (
        <Carousel
          assets={photoAssets}
          currentAssetId={slideshow.currentAssetId}
          setCurrentAssetId={setCurrentAssetId}
          moveBy={moveBy}
          rotationInterval={options.rotationIntervalSeconds}
          showPhotoInfo={options.showPhotoInfo}
          showNavigationArrows={options.showNavigationArrows}
          photoFit={options.photoFit}
          backdrop={options.backdrop}
          backdropColor={options.backdropColor}
          albumName={album.albumName}
          advanced={displayMode === "advanced"}
          paused={slideshow.paused}
          setPaused={setPaused}
          toggleSlideshow={toggleSlideshow}
        />
      )}
    </Box>
  );
}

interface CarouselProps {
  assets: {
    id: string;
    fileModifiedAt: string;
    publicLink: string;
  }[];
  currentAssetId: string | null;
  setCurrentAssetId: (assetId: string | null) => void;
  moveBy: (offset: number) => void;
  rotationInterval: number;
  showPhotoInfo: boolean;
  showNavigationArrows: boolean;
  photoFit: PhotoFit;
  backdrop: PhotoBackdrop;
  backdropColor: string;
  albumName: string;
  advanced: boolean;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  toggleSlideshow: () => void;
}

function Carousel({
  assets,
  currentAssetId,
  setCurrentAssetId,
  moveBy,
  rotationInterval,
  showPhotoInfo,
  showNavigationArrows,
  photoFit,
  backdrop,
  backdropColor,
  albumName,
  advanced,
  paused,
  toggleSlideshow,
}: CarouselProps) {
  const t = useI18n("widget.immich-albumCarousel");
  const locale = useCurrentIntlLocale();
  const reduceMotion = useReducedMotion();

  const safeCurrentIndex = resolveCurrentIndex(assets, currentAssetId);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const currentAsset = assets[safeCurrentIndex]!;

  // Restarts whenever the shown photo changes, so every photo gets the full interval.
  useEffect(() => {
    if (paused || reduceMotion || assets.length <= 1) return;
    const timeout = setTimeout(() => moveBy(1), rotationInterval * 1000);
    return () => clearTimeout(timeout);
  }, [assets.length, currentAsset.id, moveBy, paused, reduceMotion, rotationInterval]);

  const arrows = showNavigationArrows && assets.length > 1;

  return (
    <Stack w="100%" h="100%" gap={0}>
      <Box w="100%" style={{ flex: 1, minHeight: 0 }} className={classes.carouselContainer}>
        <PhotoStage
          src={currentAsset.publicLink}
          alt={t("albumPhoto")}
          fit={advanced ? "fit" : photoFit}
          backdrop={backdrop}
          backdropColor={backdropColor}
          assetId={currentAsset.id}
        />

        {arrows && <CarouselNavigation onPrevious={() => moveBy(-1)} onNext={() => moveBy(1)} />}

        {assets.length > 1 && (
          <Group
            className={classes.carouselControls}
            data-visible={advanced || paused || undefined}
            gap={4}
            wrap="nowrap"
          >
            {advanced && !arrows && (
              <ActionIcon
                aria-label={t("actions.previousPhoto")}
                variant="filled"
                color="dark"
                radius="xl"
                size={40}
                onClick={() => moveBy(-1)}
              >
                <IconChevronLeft size="var(--mantine-font-size-lg)" />
              </ActionIcon>
            )}
            <ActionIcon
              aria-label={paused ? t("actions.resumeSlideshow") : t("actions.pauseSlideshow")}
              aria-pressed={paused}
              variant="filled"
              color="dark"
              radius="xl"
              size={advanced ? 40 : 32}
              onClick={toggleSlideshow}
            >
              {paused ? (
                <IconPlayerPlay size="var(--mantine-font-size-lg)" />
              ) : (
                <IconPlayerPause size="var(--mantine-font-size-lg)" />
              )}
            </ActionIcon>
            {advanced && !arrows && (
              <ActionIcon
                aria-label={t("actions.nextPhoto")}
                variant="filled"
                color="dark"
                radius="xl"
                size={40}
                onClick={() => moveBy(1)}
              >
                <IconChevronRight size="var(--mantine-font-size-lg)" />
              </ActionIcon>
            )}
          </Group>
        )}

        {(showPhotoInfo || advanced) && (
          <Stack gap="xs" className={classes.photoInfo} p="md">
            {albumName && (
              <Text size="xs" fw={600}>
                {albumName}
              </Text>
            )}
            <Group gap="xs">
              <IconCalendar size="var(--mantine-font-size-md)" />
              <Text size="xs">{new Date(currentAsset.fileModifiedAt).toLocaleDateString(locale)}</Text>
            </Group>
            <Text size="xs" c="dimmed">
              {safeCurrentIndex + 1} / {assets.length}
            </Text>
          </Stack>
        )}
      </Box>
      {advanced && (
        <ScrollArea px="xs" py={6}>
          <Group gap={6} wrap="nowrap">
            {assets.map((asset, index) => (
              <UnstyledButton
                key={asset.id}
                onClick={() => setCurrentAssetId(asset.id)}
                aria-label={t("actions.photo", { number: index + 1 })}
                aria-pressed={index === safeCurrentIndex}
                aria-current={index === safeCurrentIndex ? "true" : undefined}
              >
                <Image
                  src={asset.publicLink}
                  alt=""
                  loading="lazy"
                  w={64}
                  h={44}
                  radius="sm"
                  fit="cover"
                  style={{ opacity: index === safeCurrentIndex ? 1 : 0.55 }}
                />
              </UnstyledButton>
            ))}
          </Group>
        </ScrollArea>
      )}
    </Stack>
  );
}

function NoPhotosInAlbum() {
  const t = useI18n("widget.immich-albumCarousel");
  return (
    <Center h="100%">
      <Stack align="center" gap="xs">
        <IconAlertCircle style={iconSizes.xl} />
        <Text size="sm" fw={500}>
          {t("noPhotos")}
        </Text>
      </Stack>
    </Center>
  );
}
```

Notes for the implementer:
- `setPaused` is kept on the props type for future use but `Carousel` only uses `toggleSlideshow`; if lint flags the unused destructure, drop `setPaused` from both the props interface and the call site rather than suppressing.
- The `.photoInfo` overlay must stay above the stage: it already has `position: absolute`; add `z-index: 2` to `.photoInfo` in the CSS if it renders under the image.
- Do not reintroduce `Math.random` in this file.

- [ ] **Step 2: Typecheck, lint, format**

```bash
cd packages/widgets && bun x tsc --noEmit -p tsconfig.json && cd ../..
bun x oxlint packages/widgets/src/immich/album-carousel
bun x oxfmt packages/widgets/src/immich/album-carousel/component.tsx packages/widgets/src/immich/album-carousel/component.module.css
```

Expected: clean apart from pre-existing warnings elsewhere.

- [ ] **Step 3: Run all widget tests touched so far**

Run: `bun x vitest run --project dom packages/widgets/src/immich packages/widgets/src/common packages/widgets/src/options.spec.ts packages/widgets/src/test/translation.spec.ts`
Expected: only the pre-existing `rssFeed` failure.

- [ ] **Step 4: Commit**

```bash
git add packages/widgets/src/immich/album-carousel/component.tsx packages/widgets/src/immich/album-carousel/component.module.css
git commit -m "feat(immich): durable slideshow state, side arrows, fitted photos"
```

---

### Task 7: End-to-end test and FORK.md

**Files:**
- Create: `e2e/immich-carousel.spec.ts`
- Modify: `FORK.md`

**Interfaces:**
- Consumes: the running fork image via `HOMARR_E2E_IMAGE` (build it first: see Task 8 Step 1; the e2e needs an image containing Tasks 1–6).
- DOM hooks: `[data-asset-id]` on the stage, `[data-carousel-nav]` on the arrows, `[data-backdrop-layer="blur"]`, the pause button's `aria-pressed`.

- [ ] **Step 1: Build a candidate image**

```bash
docker buildx build --builder homarr-fork --platform linux/amd64 -t 192.168.42.134:5000/homarr:v2.4.1-countdown.4 --push .
```

(Overwriting this tag later with the final build is fine; it is not deployed until Task 8.)

- [ ] **Step 2: Write the e2e test**

`e2e/immich-carousel.spec.ts`:

```ts
import { createId } from "@paralleldrive/cuid2";
import { chromium, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { stringify } from "superjson";
import { describe, test } from "vitest";

import * as sqliteSchema from "../packages/db/schema/sqlite";
import { createHomarrContainer } from "./shared/create-homarr-container";
import { createSqliteDbFileAsync } from "./shared/e2e-db";
import { loginAsync } from "./shared/login";
import { seedAdminUserAsync } from "./shared/seed-admin-user";

const adminCredentials = { username: "immich-admin", password: createId() + "Aa1!" };

const baseOptions = {
  albumId: "demo-paris",
  rotationIntervalSeconds: 3600,
  showPhotoInfo: false,
  randomizePhotos: true,
  showNavigationArrows: true,
  photoFit: "fit",
  backdrop: "blur",
  backdropColor: "#000000",
};

const stageOf = (page: Page, itemId: string) => page.locator(`[data-item-id="${itemId}"] [data-asset-id]`).first();
const assetIdOf = async (page: Page, itemId: string) => stageOf(page, itemId).getAttribute("data-asset-id");

describe("immich album carousel", () => {
  test("arrows, stable order, backdrops, and state across edit mode", async () => {
    const { db, localMountPath } = await createSqliteDbFileAsync();
    const { userId } = await seedAdminUserAsync(db, adminCredentials);
    const boardId = createId();
    const layoutId = createId();
    const sectionId = createId();
    const integrationId = createId();
    const blurItemId = createId();
    const colorItemId = createId();
    await db.insert(sqliteSchema.boards).values({ id: boardId, name: "immich", creatorId: userId });
    await db.insert(sqliteSchema.layouts).values({ id: layoutId, name: "Base", boardId, columnCount: 12 });
    await db.insert(sqliteSchema.sections).values({ id: sectionId, boardId, kind: "empty", xOffset: 0, yOffset: 0 });
    await db
      .insert(sqliteSchema.integrations)
      .values({ id: integrationId, name: "Mock immich", url: "http://mock.local", kind: "mock" });
    await db.insert(sqliteSchema.items).values([
      { id: blurItemId, boardId, kind: "immich-albumCarousel", options: stringify(baseOptions) },
      {
        id: colorItemId,
        boardId,
        kind: "immich-albumCarousel",
        options: stringify({ ...baseOptions, backdrop: "color", backdropColor: "#336699" }),
      },
    ]);
    await db.insert(sqliteSchema.integrationItems).values([
      { itemId: blurItemId, integrationId },
      { itemId: colorItemId, integrationId },
    ]);
    await db.insert(sqliteSchema.itemLayouts).values([
      { itemId: blurItemId, sectionId, layoutId, xOffset: 0, yOffset: 0, width: 4, height: 3 },
      { itemId: colorItemId, sectionId, layoutId, xOffset: 4, yOffset: 0, width: 4, height: 3 },
    ]);
    await db.update(sqliteSchema.users).set({ homeBoardId: boardId }).where(eq(sqliteSchema.users.id, userId));

    const container = await createHomarrContainer({
      environment: { AUTH_PROVIDERS: "credentials" },
      mounts: { "/appdata": localMountPath },
    }).start();
    const baseUrl = `http://${container.getHost()}:${container.getMappedPort(7575)}`;
    const browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" && !/net::ERR|Failed to load resource/.test(message.text())) {
        errors.push(message.text());
      }
    });

    try {
      await loginAsync({ page, baseUrl, credentials: adminCredentials, destination: "/boards/immich" });
      await expect(stageOf(page, blurItemId)).toBeVisible({ timeout: 30_000 });
      await expect(stageOf(page, colorItemId)).toBeVisible({ timeout: 30_000 });

      // Backdrops.
      await expect(page.locator(`[data-item-id="${blurItemId}"] [data-backdrop-layer="blur"]`)).toHaveCount(1);
      const blurFilter = await page
        .locator(`[data-item-id="${blurItemId}"] [data-backdrop-layer="blur"]`)
        .evaluate((element) => getComputedStyle(element).filter);
      expect(blurFilter).toContain("blur(");
      const colorBackground = await stageOf(page, colorItemId).evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(colorBackground).toBe("rgb(51, 102, 153)");

      // Arrows hidden until hover.
      const nextArrow = page.locator(`[data-item-id="${blurItemId}"] [data-carousel-nav="next"]`);
      const previousArrow = page.locator(`[data-item-id="${blurItemId}"] [data-carousel-nav="previous"]`);
      await page.mouse.move(5, 5);
      expect(await nextArrow.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
      await stageOf(page, blurItemId).hover();
      await expect(nextArrow).toBeVisible();
      await expect.poll(() => nextArrow.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");

      // Navigation.
      const first = await assetIdOf(page, blurItemId);
      await nextArrow.click();
      const second = await assetIdOf(page, blurItemId);
      expect(second).not.toBe(first);
      await previousArrow.click();
      expect(await assetIdOf(page, blurItemId)).toBe(first);
      await nextArrow.click();
      expect(await assetIdOf(page, blurItemId)).toBe(second);

      // Pause, then round-trip edit mode.
      const pauseButton = page.locator(`[data-item-id="${blurItemId}"] button[aria-pressed]`).first();
      await pauseButton.click();
      await expect(pauseButton).toHaveAttribute("aria-pressed", "true");
      const editButton = page.getByRole("button", { name: /edit mode/i }).first();
      await editButton.click();
      await page.waitForTimeout(1000);
      await editButton.click();
      await page.waitForTimeout(1000);
      await expect(stageOf(page, blurItemId)).toBeVisible({ timeout: 30_000 });
      expect(await assetIdOf(page, blurItemId)).toBe(second);
      await expect(page.locator(`[data-item-id="${blurItemId}"] button[aria-pressed]`).first()).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // Reload keeps the photo (sessionStorage).
      await page.reload({ waitUntil: "load" });
      await expect(stageOf(page, blurItemId)).toBeVisible({ timeout: 30_000 });
      expect(await assetIdOf(page, blurItemId)).toBe(second);

      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await container.stop();
    }
  }, 300_000);
});
```

Before running, confirm two selectors against the real DOM and adjust the test (not the app) if they differ:
- the board item wrapper attribute: `grep -rn "data-item-id" apps/nextjs/src/components/board/items/` (if the wrapper uses a different attribute, use that; if none exists, scope by the widget's `[data-asset-id]` order instead: blur tile first, colour tile second);
- the edit-mode header button's accessible name: `grep -rn "editMode" apps/nextjs/src/components/board/ -l` then read the aria-label it uses.
- the `integrationItems` table name in `packages/db/schema/sqlite` (`grep -n "integrationItems\|integration_item" packages/db/schema/sqlite/*.ts`).

- [ ] **Step 3: Run it against the candidate image**

```bash
HOMARR_E2E_IMAGE=192.168.42.134:5000/homarr:v2.4.1-countdown.4 NODE_ENV=development CI=true bun x vitest run --project e2e e2e/immich-carousel.spec.ts
```

Expected: PASS. If an assertion fails because the app is wrong, fix the app (Tasks 5–6 files), rebuild the candidate image (Step 1), rerun. Record in the report which it was.

- [ ] **Step 4: FORK.md**

In the touchpoint table add rows (before the `README.md` row):

```
| `packages/widgets/src/immich/album-carousel/{index.ts,component.tsx,component.module.css}` | arrows, photo fit, backdrop options; sessionStorage slideshow state; seeded order | re-apply on top of upstream; `order.spec.ts`, `photo-stage.spec.tsx` and `e2e/immich-carousel.spec.ts` must pass |
| `packages/widgets/src/options.ts`, `packages/widgets/src/_inputs/index.ts` | `color` option type (`hexColorSchema`) and its input registration | keep ours; if upstream adds a colour option, adopt theirs and drop `widget-color-input.tsx` |
| `packages/widgets/src/common/use-local-widget-state.ts` | optional `storage: "session"` | keep ours |
| `packages/translation/src/lang/en.json` (`widget.immich-albumCarousel`) | four option entries plus `photoFit`/`backdrop` label blocks | keep both |
| `apps/docs/docs/widgets/immich-album-carousel/**` | option docs and behaviour paragraph | keep ours |
```

Add after the table a short "Extracting a feature for upstream" paragraph: commits are prefixed `feat(immich):` / `feat(widgets):` / `feat(countdown):` / `feat(countdown-display):`; to extract one feature, `git log --oneline v2.4.1..countdown-display -- <paths>` lists its commits and `git cherry-pick` them onto a branch from `upstream/dev`.

Add `e2e/immich-carousel.spec.ts` to the verification commands section next to the countdown e2e line, same `HOMARR_E2E_IMAGE` form.

- [ ] **Step 5: Format and commit**

```bash
bun x oxfmt e2e/immich-carousel.spec.ts FORK.md
git add e2e/immich-carousel.spec.ts FORK.md
git commit -m "test(e2e): immich carousel arrows, backdrops, and durable state"
```

---

### Task 8: Build, push, deploy (controller runs this after the final review)

**Files:** none in this repo; `~/k8s-config/kubernetes/apps/homarr/values.yaml` and `~/k8s-config/docs/superpowers/specs/2026-10-11-homarr-design.md`.

- [ ] **Step 1: Final image**

```bash
docker buildx build --builder homarr-fork --platform linux/amd64 -t 192.168.42.134:5000/homarr:v2.4.1-countdown.4 --push .
```

- [ ] **Step 2: Rerun the e2e against it**

```bash
HOMARR_E2E_IMAGE=192.168.42.134:5000/homarr:v2.4.1-countdown.4 NODE_ENV=development CI=true bun x vitest run --project e2e e2e/immich-carousel.spec.ts e2e/countdown-display.spec.ts
```

- [ ] **Step 3: Push the branch and deploy**

```bash
git push origin countdown-display
cd ~/k8s-config
sed -i 's/tag: v2.4.1-countdown.3/tag: v2.4.1-countdown.4/' kubernetes/apps/homarr/values.yaml
sed -i 's/homarr:v2.4.1-countdown.3/homarr:v2.4.1-countdown.4/' docs/superpowers/specs/2026-10-11-homarr-design.md
git add kubernetes/apps/homarr/values.yaml docs/superpowers/specs/2026-10-11-homarr-design.md
git commit -m "homarr: fork image v2.4.1-countdown.4 (Immich carousel arrows, fit, stable order)"
git push origin main
kubectl -n homarr rollout status deploy/homarr --timeout=300s
kubectl -n homarr exec deploy/homarr -c homarr -- wget -qS -O /dev/null http://127.0.0.1:7575/api/health/ready
```

Steve authorised the k8s-config push for this feature in advance.
