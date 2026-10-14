# Immich Album carousel: navigation arrows, stable order, photo fit — design

**Date:** 2026-10-14
**Widget:** `immich-albumCarousel` (`packages/widgets/src/immich/album-carousel/`)
**Branch:** `countdown-display` (fork `stevenwcarter/homarr`, on upstream tag v2.4.1). Commits for this
work are prefixed `feat(immich):` or `feat(widgets):` and touch only the files listed under
Touchpoints, so they can be cherry-picked onto a clean upstream branch later.
**Image:** `192.168.42.134:5000/homarr:v2.4.1-countdown.4`

## Goal

Make the Immich Album slideshow something you can browse and leave alone:

1. Optional left/right arrows on the sides of the photo, visible only while the pointer is inside the
   widget (always visible on touch devices), to step backward and forward.
2. A random order that stays put. Today the order is reshuffled on every album refetch (window focus,
   reconnect, preview-to-full-album handoff), so the "current" photo silently changes.
3. A photo fit choice: `cover` (today's crop) or `fit` (whole photo visible). For `fit`, the empty
   area is filled by either a heavily blurred, enlarged copy of the same photo or a solid colour the
   user picks.
4. The slideshow's order, current photo, and paused state survive entering and leaving board edit
   mode, resizing, and a same-tab reload.

Decisions made with Steve during Q&A:

| Question | Decision |
| --- | --- |
| Branch model | Same branch, scoped commits (see header). |
| Arrow click and the timer | Restart the interval. Never change the paused state: a paused slideshow stays paused, a running one keeps running. |
| Bar colour | Free colour picker; adds a `color` option type to the shared widget options. |
| Random order lifetime | Per tab: a seed stored in sessionStorage. New tab or new browser session = new order. |
| Advanced (focus) view | Uses the same backdrop setting. It always shows the whole photo (as upstream promises), with the chosen backdrop instead of plain black. |
| Advanced arrows | When arrows are enabled, side arrows replace the top-right previous/next buttons; pause stays top-right. When arrows are disabled, the advanced view is unchanged. |
| Durable state | sessionStorage keyed by board id and item id. The widget editor preview (no item id) keeps in-memory state only. |

## Options

Added to `createOptions` in `index.ts`, after `randomizePhotos`:

| Key | Type | Default | Hidden when | Label / description (en) |
| --- | --- | --- | --- | --- |
| `showNavigationArrows` | switch | `false` | never | "Navigation arrows" / "Show previous and next arrows on the sides of the photo while the pointer is over the widget." |
| `photoFit` | select `cover` \| `fit` | `cover` | never | "Photo fit" / "Cover fills the tile and crops the photo. Fit shows the whole photo and fills the rest with the backdrop." |
| `backdrop` | select `blur` \| `color` | `blur` | never | "Backdrop" / "What fills the space around a fitted photo and behind the focus view: a blurred copy of the photo, or a solid colour." |
| `backdropColor` | color | `#000000` | never | "Backdrop colour" / "Solid colour shown around the photo when the backdrop is set to colour." |

`backdropColor` is always visible because the edit modal validates hidden fields; hiding it could block saving on an invalid value.

Select option labels are translated through the `SelectOption` label function form, as the Countdown
display widget's `font` option does, with keys `widget.immich-albumCarousel.photoFit.{cover,fit}`
("Cover", "Fit") and `widget.immich-albumCarousel.backdrop.{blur,color}` ("Blurred photo",
"Solid colour").

`backdrop` is not hidden for `cover` because it also drives the advanced view.

### New shared option type: `color`

`packages/widgets/src/options.ts` gains:

```ts
color: (input?: CommonInput<string>) => ({
  type: "color" as const,
  defaultValue: input?.defaultValue ?? "#000000",
  withDescription: input?.withDescription ?? false,
  validate: hexColorSchema, // z.string().regex(/^#[0-9a-f]{6}$/i)
}),
```

`packages/widgets/src/_inputs/widget-color-input.tsx` renders Mantine `ColorInput` (`format="hex"`,
a short swatch row of black, white, greys and the Mantine primary colour) with label and description
from `useWidgetInputTranslation`, bound via `form.getInputProps(\`options.${property}\`)` exactly like
`widget-text-input.tsx`. It is registered in `_inputs/index.ts` (`color: WidgetColorInput`); the
`satisfies Record<WidgetOptionType, unknown>` there fails to compile until it is. The widget edit
modal already applies `option.validate` generically, so the hex rule is enforced on save. If any other
exhaustive switch over `WidgetOptionType` exists (search `satisfies Record<WidgetOptionType` and
`case "slider"` across `packages/widgets` and `apps/nextjs`), it gets a `color` branch too.

## Behaviour

### Ordering (`order.ts`, pure)

- `createOrderSeed(): number` — random 32-bit unsigned integer.
- `rankAsset(seed: number, assetId: string): number` — deterministic 32-bit hash of seed and id
  (FNV-1a over the id, mixed with the seed through a mulberry32 step). Pure, no `Math.random`.
- `orderAssets<T extends { id: string }>(assets: readonly T[], options: { randomize: boolean; seed: number; firstAssetId?: string | null }): T[]`:
  - `randomize: false` → returns the album order unchanged.
  - `randomize: true` → stable sort by `rankAsset(seed, id)` with id as tiebreaker. Because each
    asset's rank depends only on the seed and its own id, adding or removing photos never changes
    the relative order of the others, and a refetch returning the same ids yields the identical order.
  - `firstAssetId` (the preview photo, as today) is moved to the front when present in the list.
- Only `IMAGE` assets are ordered, filtered before the call as today.

### Position (`order.ts`, pure)

- `resolveCurrentIndex(assets, currentAssetId: string | null): number` — index of the asset, or `0`
  when null or no longer present.
- `stepAssetId(assets, currentAssetId, offset: number): string | null` — id at
  `(resolvedIndex + offset) mod length`, `null` for an empty list.

### Durable slideshow state

`packages/widgets/src/common/use-local-widget-state.ts` gains an optional `storage?: "local" | "session"`
(default `"local"`), resolved once per call through an exported `resolveWidgetStateStorage(storage)`
helper to `window.localStorage` or `window.sessionStorage`, used for read, write, remove and the
`storage` event filter. Existing callers are unaffected.

The carousel stores one record, version `1`, key
`homarr:immich-albumCarousel:${boardId}:${itemId}:slideshow`, with `storage: "session"`:

```ts
interface SlideshowState {
  seed: number;          // integer
  currentAssetId: string | null;
  paused: boolean;
}
```

`isSlideshowState(value): value is SlideshowState` validates the shape; anything else is discarded and
replaced by a fresh default `{ seed: createOrderSeed(), currentAssetId: null, paused: false }`. When
`boardId` or `itemId` is undefined (editor preview) the key is undefined and the hook keeps the value
in memory only.

Consequences:

- Entering and leaving edit mode, resizing, moving the tile, or a same-tab reload restores the same
  seed, the same photo (by id), and the same paused flag. If the photo is no longer in the album the
  first ordered photo is shown.
- Changing the album option changes the album; the stored `currentAssetId` will not match and the
  slideshow starts at the first ordered photo of the new album. The seed is kept.
- Turning `randomizePhotos` off shows album order; the current photo id is preserved, so the visible
  photo does not change, only its neighbours do.

### Rotation timer

The auto-advance interval is created in an effect that depends on `currentAssetId`, `paused`,
`rotationInterval`, reduced-motion, and the asset count. Any change of the current photo, whether by
the timer, an arrow, a thumbnail, or a context action, restarts the interval, so the newly shown photo
always gets the full configured interval. Paused, reduced motion, or a single photo → no interval.
Arrow clicks do not touch `paused`.

### Navigation arrows (`navigation.tsx`)

`CarouselNavigation({ onPrevious, onNext })` renders two `ActionIcon` buttons (variant `filled`,
colour `dark`, radius `xl`, size 40, chevron icons, `aria-label`s from the existing
`actions.previousPhoto` / `actions.nextPhoto` keys) absolutely positioned at the vertical centre of
the left and right edges of `.carouselContainer`, 8px in. Clicks call `event.stopPropagation()` so
they never bubble into the board item's own click handling.

Visibility (CSS, `component.module.css`): the arrows are `opacity: 0; pointer-events: none` by
default and become visible on `.carouselContainer:hover` and `:focus-within`, with the same 120ms
transition the existing controls use; under `(any-pointer: coarse)` they are always visible and
44px; under `(prefers-reduced-motion: reduce)` there is no transition. This mirrors the existing
`.carouselControls` rules.

Rendered only when `showNavigationArrows` is on and there is more than one photo. In the advanced
view with arrows on, the top-right group contains only the pause/resume button. With arrows off, the
advanced view keeps its current previous/pause/next group. The right-click context actions
(`previousPhoto`, `nextPhoto`, `toggleSlideshow`) keep working in all cases.

### Photo stage (`photo-stage.tsx`)

`PhotoStage({ src, alt, fit, backdrop, backdropColor, assetId })` fills its parent and renders:

- `fit === "cover"`: the photo with `object-fit: cover`, as today. No backdrop layer.
- `fit === "fit"`: a backdrop layer behind the photo, and the photo with `object-fit: contain`.
  - `backdrop === "blur"`: an `aria-hidden` copy of the same image, `object-fit: cover`, scaled
    1.15× and blurred (`filter: blur(24px) brightness(0.7)`), clipped by the stage. The scale hides
    the blur's transparent edge halo so colours bleed to the tile edge.
  - `backdrop === "color"`: the stage background is `backdropColor`.
- The stage root carries `data-asset-id` (for tests) and `data-fit` / `data-backdrop` attributes so
  CSS and e2e assertions key off them.

The compact tile passes the user's `photoFit`; the advanced view always passes `fit: "fit"`. Both
pass the user's `backdrop` and `backdropColor`. The advanced thumbnail strip is unchanged.

### What does not change

- Query keys, the `queryMatcher`, the server preview endpoint and its `randomizePhotos` flag.
- The empty and no-photos states, photo info overlay, stale-data behaviour.
- The stock `countdown`, `countdown-display` and all other widgets.
- With default options the compact tile renders pixel-identically to today, except that a random
  order no longer changes on refetch. The advanced view's black background becomes the blurred
  backdrop (documented).

## Touchpoints

Fork-only files (new):

- `packages/widgets/src/immich/album-carousel/order.ts`, `order.spec.ts`
- `packages/widgets/src/immich/album-carousel/navigation.tsx`
- `packages/widgets/src/immich/album-carousel/photo-stage.tsx`
- `packages/widgets/src/immich/album-carousel/slideshow-state.ts` (type, validator, key builder)
- `packages/widgets/src/_inputs/widget-color-input.tsx`
- `e2e/immich-carousel.spec.ts`

Upstream files edited (rows to add to the FORK.md touchpoint table):

- `packages/widgets/src/immich/album-carousel/{index.ts,component.tsx,component.module.css}`
- `packages/widgets/src/options.ts` (color factory + hex schema)
- `packages/widgets/src/_inputs/index.ts` (register `color`)
- `packages/widgets/src/common/use-local-widget-state.ts` (`storage` option) and its spec if one exists
- `packages/translation/src/lang/en.json` (`widget.immich-albumCarousel` block)
- `apps/docs/docs/widgets/immich-album-carousel/{index.mdx,index.ts}`
- `FORK.md` (rows above, the `.4` tag, the commit-prefix extraction note)

If `SKIP_ENV_VALIDATION=true bun run scripts:update-openapi` produces a diff, commit it; it is not
expected to (widget options are opaque in the schema).

## Testing

Unit (vitest `dom` project, run from the repo root):

- `order.spec.ts`: `rankAsset` is deterministic and differs between seeds; `orderAssets` returns the
  same order for the same seed regardless of input order; inserting a new asset keeps the relative
  order of existing ones; removing one leaves the rest in order; `randomize: false` keeps album
  order; `firstAssetId` is moved to the front; `resolveCurrentIndex` falls back to 0 for null and
  missing ids; `stepAssetId` wraps both ways and returns null for an empty list.
- `slideshow-state.spec.ts`: validator accepts a well-formed record and rejects missing fields, wrong
  types, non-integer seeds.
- `use-local-widget-state.spec.ts` (extended): the hook picks its backing store through an exported
  `resolveWidgetStateStorage(storage)` helper; the test asserts it returns `window.sessionStorage`
  for `"session"` and `window.localStorage` for `"local"` and `undefined`.
- `translation.spec.ts` already asserts labels and descriptions for every option, including the new
  four.

End-to-end (`e2e/immich-carousel.spec.ts`, Playwright against the built image via
`HOMARR_E2E_IMAGE`, modelled on `e2e/countdown-display.spec.ts` and the mock-integration seeding in
`e2e/lazy-widgets.spec.ts`): seed a `mock` integration and two 4×3 carousel tiles, one with arrows +
fit + blur, one with arrows + fit + colour `#336699`, both with `randomizePhotos` on. The mock album
has several `IMAGE` assets; their external URLs will not load under `NO_EXTERNAL_CONNECTION`, so
assertions are on the DOM:

1. No page or console errors.
2. Arrows are not visible (opacity 0) until the pointer hovers the tile, then visible.
3. Clicking next changes `data-asset-id`; clicking previous restores it.
4. Pause, click next, then enter and leave board edit mode (the header button whose accessible name
   is "Edit Mode", clicked twice): the same `data-asset-id` and the paused control state are shown
   afterwards.
5. The blur tile has a backdrop element with a `blur(` filter; the colour tile's stage has background
   colour `rgb(51, 102, 153)`.
6. Reloading the page keeps the same `data-asset-id` (sessionStorage).

## Invariants this feature depends on

- Widgets receive `boardId` and `itemId` (undefined only in the editor preview). Pinned by the e2e
  test's edit-mode round trip.
- `.carouselContainer:hover` reaches the arrows: they must be descendants of that element. Pinned by
  the e2e hover assertion.
- The widget edit modal builds its zod schema from `option.validate`. Pinned by a unit test that
  `hexColorSchema` accepts `#336699` and rejects `336699`, `#36`, and `red`.
- `translation.spec.ts` enforces a label (and description when `withDescription`) for every option.

## Deployment

As for the countdown work: build with the `homarr-fork` buildx builder, tag
`v2.4.1-countdown.4`, push, bump `image.tag` in `~/k8s-config/kubernetes/apps/homarr/values.yaml`,
push k8s-config (Steve authorised this push in advance), wait for the ArgoCD rollout, probe
`/api/health/ready`.

## Follow-ups (not in scope)

- Keyboard left/right while the tile is focused.
- A "pin this photo" action that pauses and stores the id, separate from pause.
- Persisting the order across tabs (localStorage) if per-tab proves annoying.
