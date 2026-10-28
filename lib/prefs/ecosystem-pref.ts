import type { PackageEcosystem } from "@/lib/packages/package-routes";

const STORAGE_KEY = "package-ecosystem-pref";

export function getEcosystemPreference(): PackageEcosystem {
  if (typeof window === "undefined") return "npm";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "pypi" || raw === "nuget" || raw === "maven") return raw;
    return "npm";
  } catch {
    return "npm";
  }
}

export function setEcosystemPreference(ecosystem: PackageEcosystem): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, ecosystem);
  } catch {
    // ignore
  }
}
