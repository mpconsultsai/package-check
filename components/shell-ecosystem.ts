"use client";

import { createContext, useContext } from "react";
import type { PackageEcosystem } from "@/lib/package-routes";

export const ShellEcosystemContext = createContext<PackageEcosystem>("npm");

/** Registry currently selected in the search toolbar. */
export function useShellEcosystem(): PackageEcosystem {
  return useContext(ShellEcosystemContext);
}
