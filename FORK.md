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

Upstream files edited (conflicts land here). The weekly-recurrence rows touch the stock Countdowns
widget's shared code on purpose: both widgets use the same event editor and resolver.

| File | Our change | On conflict |
| --- | --- | --- |
| `packages/definitions/src/widget.ts` | `"countdownDisplay"` in `widgetKinds`; default size `3×2` | keep both sides' additions, keep ours after `"countdown"` |
| `packages/widgets/src/registry.ts` | four `countdownDisplay` entries next to `countdown` | same |
| `packages/ui/src/widget-icons.ts` | `countdownDisplay: IconHourglassHigh` | same |
| `packages/definitions/src/docs/widget-doc-slugs.ts` | `countdownDisplay: "countdown-display"` | same |
| `packages/definitions/src/docs/sitemap-paths.json` | `/docs/widgets/countdown-display` | keep both; then re-run `bun run --filter @homarr/definitions docs:generate` |
| `packages/definitions/src/docs/homarr-docs-sitemap.ts` | generated | take upstream, re-run the generator |
| `packages/translation/src/lang/en.json` | `widget.countdownDisplay` block after `widget.countdown` | keep both blocks; validate JSON. Must include a `dateTimeEventList` sub-block mirroring `widget.countdown.dateTimeEventList` (the event-list editor reads labels per widget kind; `translation.spec.ts` pins this) |
| `package.json` (catalog), `packages/widgets/package.json`, `bun.lock` | five `@fontsource*` deps | keep both; run `bun install`, commit the lockfile |
| `apps/docs/public/api/open-api-schema.json` | regenerated | take upstream, re-run `SKIP_ENV_VALIDATION=true bun run scripts:update-openapi` |
| `packages/widgets/src/options.ts`, `packages/widgets/src/_inputs/widget-date-time-event-list-input.tsx` | `"weekly"` added to the `DateTimeEventRecurrence` type, zod enum, and the Repeats dropdown | keep `"weekly"` in every list; if upstream adds its own weekly recurrence, drop ours and adopt theirs |
| `packages/widgets/src/countdown/recurrence.ts` | `findWeeklyOccurrence` + weekly branch in `getCountdownEventState`; progress uses previous/next for any recurrence | re-apply on top of upstream; `recurrence.spec.ts` weekly cases must pass |
| `packages/widgets/src/countdown/component.tsx`, `packages/widgets/src/countdown/recurrence.spec.ts` | recurrence badge shows `t(recurrence)` for any non-`none` value; weekly tests | keep ours |
| `apps/docs/docs/widgets/countdown/**` | "one-time, weekly, or yearly" wording | keep ours |
| `README.md` | fork-only file (upstream v2.4.1 has no root README); if upstream re-adds one, keep our pointer at the top of theirs | keep ours at the top |

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
`groupCountdownStates`), the typecheck plus `duration.spec.ts` and `tiles.spec.tsx` will say so.

## Verification

```bash
bun run test packages/widgets/src/countdown-display packages/widgets/src/test/translation.spec.ts
bun run --filter @homarr/definitions --filter @homarr/ui --filter @homarr/widgets --filter @homarr/nextjs typecheck
bun run --filter @homarr/widgets lint && bun run format
bun run --filter @homarr/docs validate:coverage
bun run check:openapi
```

`translation.spec.ts` has one failure, the `rssFeed descriptionMaxLength` case. It is pre-existing at
v2.4.1 and unrelated to this widget. `bun run format` is the check form (`turbo format -- --check`,
what CI runs); it may also flag upstream's `packages/widgets/src/rssFeed/component.tsx`, which is
likewise pre-existing.

Optional visual check of the layout and fonts against a locally built image (needs Docker; set
`COUNTDOWN_SHOTS_DIR` to also write dark/light board screenshots):

```bash
HOMARR_E2E_IMAGE=192.168.42.134:5000/homarr:v2.4.1-countdown.1 NODE_ENV=development CI=true \
  bun x vitest run --project e2e e2e/countdown-display.spec.ts
```

`HOMARR_E2E_IMAGE` must be set or the e2e helper throws.

## Build and push the image

Tag scheme: `<upstream tag>-countdown.<n>`; `n` restarts at 1 for each upstream tag and increments for
fork-only changes on the same upstream version.

This machine's Docker daemon has no insecure-registries entry for the plain-HTTP registry, so the
image is pushed through a buildx docker-container builder. One-time setup (`docker buildx rm
homarr-fork` removes it):

```bash
# one-time: a builder that trusts the plain-HTTP registry (no daemon.json change needed)
cat > ~/.config/homarr-fork-buildkitd.toml <<'EOT'
[registry."192.168.42.134:5000"]
  http = true
  insecure = true
EOT
docker buildx create --name homarr-fork --driver docker-container --config ~/.config/homarr-fork-buildkitd.toml
docker buildx inspect homarr-fork --bootstrap
```

Then build and push:

```bash
docker buildx build --builder homarr-fork --platform linux/amd64 \
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
