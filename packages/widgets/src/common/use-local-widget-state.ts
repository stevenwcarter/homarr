"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface StoredWidgetState {
  version: number;
  value: unknown;
}

export type WidgetStateStorage = "local" | "session";

export const resolveWidgetStateStorage = (storage?: WidgetStateStorage): Storage =>
  storage === "session" ? window.sessionStorage : window.localStorage;

interface UseLocalWidgetStateOptions<T> {
  key: string | undefined;
  version: number;
  defaultValue: T | (() => T);
  validate?: (value: unknown) => value is T;
  migrate?: (value: unknown, storedVersion: number) => T | undefined;
  storage?: WidgetStateStorage;
}

const resolveDefaultValue = <T>(value: T | (() => T)): T =>
  typeof value === "function" ? (value as () => T)() : value;

export const serializeLocalWidgetState = <T>(version: number, value: T): string => JSON.stringify({ version, value });

export const parseLocalWidgetState = <T>(
  serialized: string,
  version: number,
  validate?: (value: unknown) => value is T,
  migrate?: (value: unknown, storedVersion: number) => T | undefined,
): T | undefined => {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || !("value" in parsed)) {
      return undefined;
    }

    const stored = parsed as StoredWidgetState;
    if (typeof stored.version !== "number") return undefined;
    if (stored.version !== version) {
      const migrated = migrate?.(stored.value, stored.version);
      if (migrated === undefined || (validate && !validate(migrated))) return undefined;
      return migrated;
    }
    if (validate && !validate(stored.value)) return undefined;
    return stored.value as T;
  } catch {
    return undefined;
  }
};

export const useLocalWidgetState = <T>({
  key,
  version,
  defaultValue,
  validate,
  migrate,
  storage,
}: UseLocalWidgetStateOptions<T>): [T, Dispatch<SetStateAction<T>>, () => void] => {
  const defaultValueRef = useRef(defaultValue);
  const validateRef = useRef(validate);
  const migrateRef = useRef(migrate);
  defaultValueRef.current = defaultValue;
  validateRef.current = validate;
  migrateRef.current = migrate;

  const createDefaultValue = useCallback(() => resolveDefaultValue(defaultValueRef.current), []);
  const [value, setValueState] = useState<T>(createDefaultValue);
  const valueRef = useRef(value);

  const setMemoryValue = useCallback((nextValue: T) => {
    valueRef.current = nextValue;
    setValueState(nextValue);
  }, []);

  const removeStoredValue = useCallback(() => {
    if (!key) return;
    try {
      resolveWidgetStateStorage(storage).removeItem(key);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }, [key, storage]);

  useEffect(() => {
    if (!key) {
      setMemoryValue(createDefaultValue());
      return;
    }

    try {
      const serialized = resolveWidgetStateStorage(storage).getItem(key);
      if (serialized === null) {
        setMemoryValue(createDefaultValue());
        return;
      }
      const parsed = parseLocalWidgetState(serialized, version, validateRef.current, migrateRef.current);
      if (parsed === undefined) {
        resolveWidgetStateStorage(storage).removeItem(key);
        setMemoryValue(createDefaultValue());
        return;
      }
      setMemoryValue(parsed);
    } catch {
      setMemoryValue(createDefaultValue());
    }
  }, [createDefaultValue, key, setMemoryValue, storage, version]);

  useEffect(() => {
    if (!key) return;

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== resolveWidgetStateStorage(storage) || event.key !== key) return;
      if (event.newValue === null) {
        setMemoryValue(createDefaultValue());
        return;
      }

      const parsed = parseLocalWidgetState(event.newValue, version, validateRef.current, migrateRef.current);
      if (parsed !== undefined) setMemoryValue(parsed);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [createDefaultValue, key, setMemoryValue, storage, version]);

  const setValue: Dispatch<SetStateAction<T>> = useCallback(
    (nextValue) => {
      const resolved =
        typeof nextValue === "function" ? (nextValue as (previous: T) => T)(valueRef.current) : nextValue;
      if (Object.is(resolved, valueRef.current)) return;
      setMemoryValue(resolved);
      if (key) {
        try {
          resolveWidgetStateStorage(storage).setItem(key, serializeLocalWidgetState(version, resolved));
        } catch {
          // Keep the in-memory state usable when persistence is unavailable.
        }
      }
    },
    [key, setMemoryValue, storage, version],
  );

  const resetValue = useCallback(() => {
    removeStoredValue();
    setMemoryValue(createDefaultValue());
  }, [createDefaultValue, removeStoredValue, setMemoryValue]);

  return [value, setValue, resetValue];
};
