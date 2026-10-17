"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getAiAnalysisEnabled,
  getAiAnalysisEnabledServerSnapshot,
  setAiAnalysisEnabled,
  subscribeAiAnalysisPref,
} from "@/lib/prefs/ai-analysis-pref";

export function useAiAnalysisEnabled(): boolean {
  return useSyncExternalStore(
    subscribeAiAnalysisPref,
    getAiAnalysisEnabled,
    getAiAnalysisEnabledServerSnapshot,
  );
}

/** False until after mount, so localStorage can be read without an on→off flash. */
export function useAiAnalysisPrefReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
}

export function useAiAnalysisPref() {
  const enabled = useAiAnalysisEnabled();
  const ready = useAiAnalysisPrefReady();
  const setEnabled = useCallback((value: boolean) => {
    setAiAnalysisEnabled(value);
  }, []);
  return { enabled, setEnabled, ready };
}
