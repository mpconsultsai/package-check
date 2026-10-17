export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "npv-theme";

type Listener = () => void;

const listeners = new Set<Listener>();
let storageHydrated = false;
let preference: ThemePreference = "system";

const emit = () => {
  listeners.forEach((listener) => listener());
};

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

function hydrateFromStorage(): void {
  if (storageHydrated) return;
  storageHydrated = true;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  preference = isThemePreference(raw) ? raw : "system";
  emit();
}

const read = (): ThemePreference => {
  if (typeof window === "undefined") return "system";
  if (!storageHydrated) return "system";
  return preference;
};

export const subscribeThemePref = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if (typeof window !== "undefined" && !storageHydrated) {
    queueMicrotask(() => hydrateFromStorage());
  }
  return () => listeners.delete(listener);
};

export const getThemePreference = (): ThemePreference => read();

export const getThemePreferenceServerSnapshot = (): ThemePreference =>
  "system";

export const setThemePreference = (value: ThemePreference): void => {
  if (storageHydrated && preference === value) return;
  preference = value;
  storageHydrated = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore quota / private mode
  }
  emit();
};

export function resolveTheme(
  pref: ThemePreference,
  systemDark: boolean,
): "light" | "dark" {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

/** Inline boot script - apply class before paint to avoid flash. */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(STORAGE_KEY)};var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var dark=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",dark);r.style.colorScheme=dark?"dark":"light";}catch(e){}})();`;
