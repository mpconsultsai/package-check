"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  clearNpmProjectContext,
  getNpmProjectContext,
  getNpmProjectContextServerSnapshot,
  setNpmProjectContextFromText,
  subscribeNpmProjectContext,
  type NpmProjectContext,
} from "@/lib/prefs/npm-project-context";

export function useNpmProjectContext() {
  const context = useSyncExternalStore(
    subscribeNpmProjectContext,
    getNpmProjectContext,
    getNpmProjectContextServerSnapshot,
  );

  const applyText = useCallback((text: string): NpmProjectContext | null => {
    return setNpmProjectContextFromText(text);
  }, []);

  const clear = useCallback(() => {
    clearNpmProjectContext();
  }, []);

  return { context, applyText, clear };
}
