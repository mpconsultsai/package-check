type Listener = () => void;

type LocalPrefStoreOptions<T> = {
  key: string;
  defaultValue: T;
  parse: (raw: string | null) => T;
  /** Return `null` to remove the key (e.g. empty optional prefs). */
  serialize: (value: T) => string | null;
  equal?: (a: T, b: T) => boolean;
};

/**
 * Tiny localStorage-backed preference store with SSR-safe snapshots.
 * One concern: sync a single typed value across subscribers.
 */
export const createLocalPrefStore = <T>(options: LocalPrefStoreOptions<T>) => {
  const listeners = new Set<Listener>();
  const equal = options.equal ?? Object.is;
  let storageHydrated = false;
  let value = options.defaultValue;

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const hydrateFromStorage = (): void => {
    if (storageHydrated) return;
    storageHydrated = true;
    try {
      value = options.parse(window.localStorage.getItem(options.key));
    } catch {
      value = options.defaultValue;
    }
    emit();
  };

  const read = (): T => {
    if (typeof window === "undefined") return options.defaultValue;
    if (!storageHydrated) return options.defaultValue;
    return value;
  };

  const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener);
    if (typeof window !== "undefined" && !storageHydrated) {
      queueMicrotask(() => hydrateFromStorage());
    }
    return () => listeners.delete(listener);
  };

  const getServerSnapshot = (): T => options.defaultValue;

  const set = (next: T): void => {
    if (storageHydrated && equal(value, next)) return;
    value = next;
    storageHydrated = true;
    try {
      const serialized = options.serialize(next);
      if (serialized === null) window.localStorage.removeItem(options.key);
      else window.localStorage.setItem(options.key, serialized);
    } catch {
      // ignore quota / private mode
    }
    emit();
  };

  /** Ensure storage has been read before a first write (optional prefs). */
  const ensureHydrated = (): void => {
    if (typeof window !== "undefined") hydrateFromStorage();
  };

  return {
    subscribe,
    get: read,
    getServerSnapshot,
    set,
    ensureHydrated,
  };
};
