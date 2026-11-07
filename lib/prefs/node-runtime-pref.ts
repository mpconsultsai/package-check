const STORAGE_KEY = "npv-node-runtime-version";

type Listener = () => void;

const listeners = new Set<Listener>();
let storageHydrated = false;
let version = "";

const emit = () => {
  listeners.forEach((listener) => listener());
};

export type NodeRuntimeParse =
  | { ok: true; value: string }
  | { ok: false; message: string };

/**
 * Accepts bare versions like 20, 20.11, 20.11.1 — empty is valid (clears).
 * Rejects ranges, tags, and other non-version strings.
 */
export function parseNodeRuntimeVersion(value: unknown): NodeRuntimeParse {
  if (typeof value !== "string") {
    return { ok: false, message: "Enter a Node version like 22.14.0" };
  }
  const trimmed = value.trim().replace(/^v/i, "");
  if (!trimmed) return { ok: true, value: "" };
  if (!/^\d+(?:\.\d+){0,2}$/.test(trimmed)) {
    return {
      ok: false,
      message: "Enter a Node version like 22 or 22.14.0",
    };
  }
  const parts = trimmed.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return {
      ok: false,
      message: "Enter a Node version like 22 or 22.14.0",
    };
  }
  if (parts[0] === 0 || parts[0] > 99) {
    return {
      ok: false,
      message: "Enter a released Node major (for example 20 or 22)",
    };
  }
  return { ok: true, value: trimmed };
}

/** Empty or a normalized Node version; invalid input becomes empty. */
export function normalizeNodeRuntimeVersion(value: unknown): string {
  const parsed = parseNodeRuntimeVersion(value);
  return parsed.ok ? parsed.value : "";
}

function hydrateFromStorage(): void {
  if (storageHydrated) return;
  storageHydrated = true;
  try {
    version = normalizeNodeRuntimeVersion(
      window.localStorage.getItem(STORAGE_KEY) ?? "",
    );
  } catch {
    version = "";
  }
  emit();
}

export const subscribeNodeRuntimePref = (
  listener: Listener,
): (() => void) => {
  listeners.add(listener);
  if (typeof window !== "undefined" && !storageHydrated) {
    queueMicrotask(() => hydrateFromStorage());
  }
  return () => listeners.delete(listener);
};

export function getNodeRuntimeVersion(): string {
  if (typeof window === "undefined") return "";
  if (!storageHydrated) return "";
  return version;
}

export function getNodeRuntimeVersionServerSnapshot(): string {
  return "";
}

export function setNodeRuntimeVersion(value: string): void {
  if (typeof window !== "undefined") {
    hydrateFromStorage();
  }
  const next = normalizeNodeRuntimeVersion(value);
  version = next;
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, next);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
  emit();
}
