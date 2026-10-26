const STORAGE_KEY = "npv-npm-release-cooldown-hours";

/** Default matches common enterprise “wait a day” install policies. */
export const DEFAULT_NPM_RELEASE_COOLDOWN_HOURS = 24;

/** Allowed Settings choices (hours). 0 turns the caution off. */
export const NPM_RELEASE_COOLDOWN_OPTIONS = [
  0, 12, 24, 48, 72, 168,
] as const;

export type NpmReleaseCooldownHours =
  (typeof NPM_RELEASE_COOLDOWN_OPTIONS)[number];

const MIN_HOURS = 0;
const MAX_HOURS = 168;

type Listener = () => void;

const listeners = new Set<Listener>();
let storageHydrated = false;
let hours: NpmReleaseCooldownHours = DEFAULT_NPM_RELEASE_COOLDOWN_HOURS;

const emit = () => {
  listeners.forEach((listener) => listener());
};

export function clampNpmReleaseCooldownHours(
  value: unknown,
): NpmReleaseCooldownHours {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_NPM_RELEASE_COOLDOWN_HOURS;
  const rounded = Math.round(n);
  const clamped = Math.min(MAX_HOURS, Math.max(MIN_HOURS, rounded));
  const match = NPM_RELEASE_COOLDOWN_OPTIONS.find((option) => option === clamped);
  if (match !== undefined) return match;
  // Nearest allowed option when a non-preset integer is passed.
  let best: NpmReleaseCooldownHours = DEFAULT_NPM_RELEASE_COOLDOWN_HOURS;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of NPM_RELEASE_COOLDOWN_OPTIONS) {
    const distance = Math.abs(option - clamped);
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return best;
}

function hydrateFromStorage(): void {
  if (storageHydrated) return;
  storageHydrated = true;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  hours =
    raw === null
      ? DEFAULT_NPM_RELEASE_COOLDOWN_HOURS
      : clampNpmReleaseCooldownHours(raw);
  emit();
}

const read = (): NpmReleaseCooldownHours => {
  if (typeof window === "undefined") return DEFAULT_NPM_RELEASE_COOLDOWN_HOURS;
  if (!storageHydrated) return DEFAULT_NPM_RELEASE_COOLDOWN_HOURS;
  return hours;
};

export const subscribeNpmReleaseCooldownPref = (
  listener: Listener,
): (() => void) => {
  listeners.add(listener);
  if (typeof window !== "undefined" && !storageHydrated) {
    queueMicrotask(() => hydrateFromStorage());
  }
  return () => listeners.delete(listener);
};

export const getNpmReleaseCooldownHours = (): NpmReleaseCooldownHours => read();

export const getNpmReleaseCooldownHoursServerSnapshot =
  (): NpmReleaseCooldownHours => DEFAULT_NPM_RELEASE_COOLDOWN_HOURS;

export const setNpmReleaseCooldownHours = (
  value: NpmReleaseCooldownHours | number | string,
): void => {
  const next = clampNpmReleaseCooldownHours(value);
  if (storageHydrated && hours === next) return;
  hours = next;
  storageHydrated = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // ignore quota / private mode
  }
  emit();
};

export function npmReleaseCooldownLabel(value: NpmReleaseCooldownHours): string {
  if (value === 0) return "Off";
  if (value === 168) return "7 days";
  return `${value} hours`;
}
