import { createLocalPrefStore } from "@/lib/prefs/local-pref-store";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "npv-theme";

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

const store = createLocalPrefStore<ThemePreference>({
  key: STORAGE_KEY,
  defaultValue: "system",
  parse: (raw) => (isThemePreference(raw) ? raw : "system"),
  serialize: (value) => value,
});

export const subscribeThemePref = store.subscribe;
export const getThemePreference = store.get;
export const getThemePreferenceServerSnapshot = store.getServerSnapshot;
export const setThemePreference = store.set;

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
