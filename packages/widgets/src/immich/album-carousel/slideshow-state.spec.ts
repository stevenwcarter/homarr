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
