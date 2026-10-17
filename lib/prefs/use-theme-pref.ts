"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getThemePreference,
  getThemePreferenceServerSnapshot,
  resolveTheme,
  setThemePreference,
  subscribeThemePref,
  type ThemePreference,
} from "@/lib/prefs/theme-pref";

let systemDarkHydrated = false;

function subscribeSystemDark(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onStoreChange();
  mq.addEventListener("change", handler);
  if (!systemDarkHydrated) {
    queueMicrotask(() => {
      systemDarkHydrated = true;
      onStoreChange();
    });
  }
  return () => mq.removeEventListener("change", handler);
}

function getSystemDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  if (!systemDarkHydrated) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribeThemePref,
    getThemePreference,
    getThemePreferenceServerSnapshot,
  );
}

export function useSystemDark(): boolean {
  return useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);
}

export function useThemePrefReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
}

export function useThemePref() {
  const preference = useThemePreference();
  const systemDark = useSystemDark();
  const ready = useThemePrefReady();
  const resolved = resolveTheme(preference, systemDark);

  const setPreference = useCallback((value: ThemePreference) => {
    setThemePreference(value);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  return { preference, setPreference, resolved, ready };
}
