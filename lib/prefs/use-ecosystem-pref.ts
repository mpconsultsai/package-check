"use client";

import { useCallback, useEffect, useState } from "react";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import {
  getEcosystemPreference,
  setEcosystemPreference,
} from "@/lib/prefs/ecosystem-pref";

export function useEcosystemPref() {
  const [ecosystem, setEcosystemState] = useState<PackageEcosystem>("npm");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEcosystemState(getEcosystemPreference());
    setReady(true);
  }, []);

  const setEcosystem = useCallback((next: PackageEcosystem) => {
    setEcosystemState(next);
    setEcosystemPreference(next);
  }, []);

  return { ecosystem, setEcosystem, ready };
}
