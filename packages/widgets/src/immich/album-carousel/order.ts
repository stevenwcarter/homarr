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
