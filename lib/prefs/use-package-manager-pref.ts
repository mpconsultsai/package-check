"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getPackageManagerPreference,
  getPackageManagerPreferenceServerSnapshot,
  setPackageManagerPreference,
  subscribePackageManagerPref,
  type PackageManagerPreference,
} from "@/lib/prefs/package-manager-pref";

export function usePackageManagerPreference(): PackageManagerPreference {
  return useSyncExternalStore(
    subscribePackageManagerPref,
    getPackageManagerPreference,
    getPackageManagerPreferenceServerSnapshot,
  );
}

export function usePackageManagerPrefReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
}

export function usePackageManagerPref() {
  const preference = usePackageManagerPreference();
  const ready = usePackageManagerPrefReady();

  const setPreference = useCallback((value: PackageManagerPreference) => {
    setPackageManagerPreference(value);
  }, []);

  return { preference, setPreference, ready };
}
