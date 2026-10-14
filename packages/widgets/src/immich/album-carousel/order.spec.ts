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
    expect(ids(ordered).toSorted()).toEqual(ids(album).toSorted());
    expect(ids(ordered)).not.toEqual(ids(album));
  });

  it("returns the same order for the same seed regardless of input order", () => {
    const shuffledInput = ["d", "a", "h", "b", "f", "c", "g", "e"].map(asset);
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
    const withoutC = ids(
      orderAssets(
        album.filter((item) => item.id !== "c"),
        { randomize: true, seed: 5 },
      ),
    );
    expect(withExtra).toEqual(base);
    expect(withoutC).toEqual(base.filter((id) => id !== "c"));
  });

  it("moves the preview photo to the front", () => {
    const ordered = ids(orderAssets(album, { randomize: true, seed: 5, firstAssetId: "f" }));
    expect(ordered[0]).toBe("f");
    expect(ordered.toSorted()).toEqual(ids(album).toSorted());
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
