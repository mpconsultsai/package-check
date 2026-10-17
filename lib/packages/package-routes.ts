export const PACKAGE_ECOSYSTEMS = ["npm", "pypi", "nuget"] as const;

export type PackageEcosystem = (typeof PACKAGE_ECOSYSTEMS)[number];

export function registryLabel(ecosystem: PackageEcosystem): string {
  if (ecosystem === "pypi") return "PyPI";
  if (ecosystem === "nuget") return "NuGet";
  return "npm";
}

export function registryPackageUrl(
  ecosystem: PackageEcosystem,
  name: string,
): string {
  const id = encodeURIComponent(name);
  if (ecosystem === "pypi") return `https://pypi.org/project/${id}/`;
  if (ecosystem === "nuget") return `https://www.nuget.org/packages/${id}`;
  return `https://www.npmjs.com/package/${id}`;
}

/** GitHub Advisory Database ecosystem query value. */
export function advisoryEcosystem(
  ecosystem: PackageEcosystem,
): "npm" | "pip" | "nuget" {
  if (ecosystem === "pypi") return "pip";
  if (ecosystem === "nuget") return "nuget";
  return "npm";
}

export function packagePagePath(
  ecosystem: PackageEcosystem,
  name: string,
): string {
  const trimmed = name.trim();
  return `/${ecosystem}/${encodeURIComponent(trimmed)}`;
}

export function parsePackageRoute(pathname: string): {
  ecosystem: PackageEcosystem;
  name: string;
} | null {
  for (const ecosystem of PACKAGE_ECOSYSTEMS) {
    const prefix = `/${ecosystem}/`;
    if (!pathname.startsWith(prefix)) continue;
    const segment = pathname.slice(prefix.length).split("/")[0] ?? "";
    if (!segment) return null;
    try {
      return { ecosystem, name: decodeURIComponent(segment) };
    } catch {
      return { ecosystem, name: segment };
    }
  }
  if (pathname.startsWith("/package/")) {
    const segment = pathname.slice("/package/".length).split("/")[0] ?? "";
    if (!segment) return null;
    try {
      return { ecosystem: "npm", name: decodeURIComponent(segment) };
    } catch {
      return { ecosystem: "npm", name: segment };
    }
  }
  return null;
}

export function watchlistEntryKey(
  ecosystem: PackageEcosystem,
  name: string,
): string {
  return `${ecosystem}:${name.toLowerCase()}`;
}
