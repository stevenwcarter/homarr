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
