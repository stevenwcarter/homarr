// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseLocalWidgetState,
  resolveWidgetStateStorage,
  serializeLocalWidgetState,
  useLocalWidgetState,
} from "./use-local-widget-state";

const isCounterState = (value: unknown): value is { count: number } =>
  typeof value === "object" && value !== null && "count" in value && typeof value.count === "number";

describe("local widget state serialization", () => {
  it("round trips validated state", () => {
    const serialized = serializeLocalWidgetState(1, { count: 3 });
    expect(parseLocalWidgetState(serialized, 1, isCounterState)).toEqual({ count: 3 });
  });

  it("rejects malformed and invalid state", () => {
    expect(parseLocalWidgetState("not-json", 1, isCounterState)).toBeUndefined();
    expect(parseLocalWidgetState('{"version":1,"value":{"count":"3"}}', 1, isCounterState)).toBeUndefined();
  });

  it("uses the supplied migration for old versions", () => {
    const serialized = serializeLocalWidgetState(1, { oldCount: 4 });
    expect(
      parseLocalWidgetState(serialized, 2, isCounterState, (value) => {
        if (typeof value !== "object" || value === null || !("oldCount" in value)) return undefined;
        return { count: Number(value.oldCount) };
      }),
    ).toEqual({ count: 4 });
  });
});

describe("resolveWidgetStateStorage", () => {
  it("returns session storage for 'session' and local storage otherwise", () => {
    expect(resolveWidgetStateStorage("session")).toBe(window.sessionStorage);
    expect(resolveWidgetStateStorage("local")).toBe(window.localStorage);
    expect(resolveWidgetStateStorage(undefined)).toBe(window.localStorage);
  });
});

const createMemoryStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
};

const renderHook = async (persistDefault?: boolean) => {
  const Probe = () => {
    useLocalWidgetState({
      key: "test:persist",
      storage: "session",
      version: 1,
      defaultValue: () => ({ n: 7 }),
      persistDefault,
    });
    return null;
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(() => root.render(createElement(Probe)));
  await act(() => root.unmount());
};

describe("useLocalWidgetState persistDefault", () => {
  beforeEach(() => {
    // Node's experimental global localStorage getter shadows jsdom's and yields undefined without a backing file.
    if (window.localStorage === undefined) vi.stubGlobal("localStorage", createMemoryStorage());
  });

  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("writes the default value to the chosen storage when requested", async () => {
    await renderHook(true);
    expect(window.sessionStorage.getItem("test:persist")).toBe(serializeLocalWidgetState(1, { n: 7 }));
    expect(window.localStorage.getItem("test:persist")).toBeNull();
  });

  it("leaves storage untouched by default", async () => {
    await renderHook();
    expect(window.sessionStorage.getItem("test:persist")).toBeNull();
  });
});
