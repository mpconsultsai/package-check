const STORAGE_KEY = "npv-ai-analysis";

type Listener = () => void;

const listeners = new Set<Listener>();
let storageHydrated = false;
let enabled = true;

const emit = () => {
  listeners.forEach((listener) => listener());
};

function hydrateFromStorage(): void {
  if (storageHydrated) return;
  storageHydrated = true;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  enabled = raw === null ? true : raw === "1" || raw === "true";
  emit();
}

const read = (): boolean => {
  if (typeof window === "undefined") return true;
  if (!storageHydrated) return true;
  return enabled;
};

export const subscribeAiAnalysisPref = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if (typeof window !== "undefined" && !storageHydrated) {
    queueMicrotask(() => hydrateFromStorage());
  }
  return () => listeners.delete(listener);
};

export const getAiAnalysisEnabled = (): boolean => read();

export const getAiAnalysisEnabledServerSnapshot = (): boolean => true;

export const setAiAnalysisEnabled = (value: boolean): void => {
  const next = Boolean(value);
  if (storageHydrated && enabled === next) return;
  enabled = next;
  storageHydrated = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
  emit();
};
