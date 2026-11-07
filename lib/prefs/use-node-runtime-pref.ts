"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getNodeRuntimeVersion,
  getNodeRuntimeVersionServerSnapshot,
  setNodeRuntimeVersion,
  subscribeNodeRuntimePref,
} from "@/lib/prefs/node-runtime-pref";

export function useNodeRuntimePref() {
  const version = useSyncExternalStore(
    subscribeNodeRuntimePref,
    getNodeRuntimeVersion,
    getNodeRuntimeVersionServerSnapshot,
  );

  const setVersion = useCallback((value: string) => {
    setNodeRuntimeVersion(value);
  }, []);

  return { version, setVersion };
}
