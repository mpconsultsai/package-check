import { createLocalPrefStore } from "@/lib/prefs/local-pref-store";

const STORAGE_KEY = "npv-ai-analysis";

const store = createLocalPrefStore<boolean>({
  key: STORAGE_KEY,
  defaultValue: true,
  parse: (raw) => (raw === null ? true : raw === "1" || raw === "true"),
  serialize: (value) => (value ? "1" : "0"),
});

export const subscribeAiAnalysisPref = store.subscribe;
export const getAiAnalysisEnabled = store.get;
export const getAiAnalysisEnabledServerSnapshot = store.getServerSnapshot;

export const setAiAnalysisEnabled = (value: boolean): void => {
  store.set(Boolean(value));
};
