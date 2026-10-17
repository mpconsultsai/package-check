import type { PackageAnalysisResult } from "@/lib/types/package-data";

/** Lifetime downloads above which System.* and Microsoft.* stay current. */
export const STABLE_DOTNET_PLATFORM_DOWNLOADS = 100_000_000;

type PlatformPackage = Pick<
  PackageAnalysisResult,
  "ecosystem" | "packageName" | "npm" | "downloads"
>;

/** Inbox assemblies such as System.Runtime and Microsoft.Extensions.Logging. */
export function isDotnetInboxPackageId(name: string): boolean {
  return /^(system|microsoft)\./i.test(name.trim());
}

export function isStableDotnetPlatformPackage(
  packageData: PlatformPackage,
): boolean {
  if (packageData.ecosystem !== "nuget") return false;
  if (packageData.downloads?.period !== "total") return false;
  if (
    (packageData.downloads.downloads ?? 0) < STABLE_DOTNET_PLATFORM_DOWNLOADS
  ) {
    return false;
  }
  const name = (packageData.npm?.name || packageData.packageName || "").trim();
  return isDotnetInboxPackageId(name);
}
