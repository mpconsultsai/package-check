import {
  fingerprintNpmProjectContext,
  parseNpmProjectContext,
  type NpmProjectContextParsed,
  type NpmProjectContextSource,
} from "@/lib/parse/parse-npm-project-context";

const STORAGE_KEY = "npv-npm-project-context-v1";

type Listener = () => void;

const listeners = new Set<Listener>();
let storageHydrated = false;

export type NpmProjectContext = {
  rawText: string;
  source: NpmProjectContextSource;
  updatedAt: number;
  deps: Record<string, string>;
  enginesNode: string | null;
  packageCount: number;
  truncated: boolean;
  fingerprint: string;
};

const EMPTY: NpmProjectContext | null = null;
let snapshot: NpmProjectContext | null = EMPTY;

const emit = () => {
  listeners.forEach((listener) => listener());
};

function fromParsed(
  rawText: string,
  parsed: NpmProjectContextParsed,
  updatedAt = Date.now(),
): NpmProjectContext {
  return {
    rawText,
    source: parsed.source,
    updatedAt,
    deps: parsed.deps,
    enginesNode: parsed.enginesNode,
    packageCount: parsed.packageCount,
    truncated: parsed.truncated,
    fingerprint: fingerprintNpmProjectContext(
      parsed.deps,
      parsed.enginesNode,
    ),
  };
}

function readRaw(): NpmProjectContext | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      rawText?: unknown;
      updatedAt?: unknown;
    };
    if (typeof data.rawText !== "string" || !data.rawText.trim()) return null;
    const parsed = parseNpmProjectContext(data.rawText);
    if (parsed.packageCount === 0 && !parsed.enginesNode) return null;
    return fromParsed(
      data.rawText,
      parsed,
      typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
    );
  } catch {
    return null;
  }
}

function hydrateFromStorage(): void {
  if (storageHydrated) return;
  storageHydrated = true;
  snapshot = readRaw();
  emit();
}

export const subscribeNpmProjectContext = (
  listener: Listener,
): (() => void) => {
  listeners.add(listener);
  if (typeof window !== "undefined" && !storageHydrated) {
    queueMicrotask(() => hydrateFromStorage());
  }
  return () => listeners.delete(listener);
};

export function getNpmProjectContext(): NpmProjectContext | null {
  if (typeof window === "undefined") return null;
  if (!storageHydrated) return null;
  return snapshot;
}

export function getNpmProjectContextServerSnapshot(): NpmProjectContext | null {
  return null;
}

/** Apply pasted package.json / lockfile text as project context. */
export function setNpmProjectContextFromText(
  text: string,
): NpmProjectContext | null {
  if (typeof window !== "undefined") {
    hydrateFromStorage();
  }
  const trimmed = text.trim();
  if (!trimmed) {
    clearNpmProjectContext();
    return null;
  }
  const parsed = parseNpmProjectContext(trimmed);
  if (parsed.packageCount === 0 && !parsed.enginesNode) {
    clearNpmProjectContext();
    return null;
  }
  const next = fromParsed(trimmed, parsed);
  snapshot = next;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rawText: next.rawText, updatedAt: next.updatedAt }),
    );
  } catch {
    // ignore quota / private mode
  }
  emit();
  return next;
}

export function clearNpmProjectContext(): void {
  if (typeof window !== "undefined") {
    hydrateFromStorage();
  }
  snapshot = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
}
