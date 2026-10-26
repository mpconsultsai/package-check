"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getNpmReleaseCooldownHours,
  getNpmReleaseCooldownHoursServerSnapshot,
  setNpmReleaseCooldownHours,
  subscribeNpmReleaseCooldownPref,
  type NpmReleaseCooldownHours,
} from "@/lib/prefs/npm-release-cooldown-pref";

export function useNpmReleaseCooldownHours(): NpmReleaseCooldownHours {
  return useSyncExternalStore(
    subscribeNpmReleaseCooldownPref,
    getNpmReleaseCooldownHours,
    getNpmReleaseCooldownHoursServerSnapshot,
  );
}

export function useNpmReleaseCooldownPrefReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
}

export function useNpmReleaseCooldownPref() {
  const hours = useNpmReleaseCooldownHours();
  const ready = useNpmReleaseCooldownPrefReady();

  const setHours = useCallback((value: NpmReleaseCooldownHours) => {
    setNpmReleaseCooldownHours(value);
  }, []);

  return { hours, setHours, ready };
}
