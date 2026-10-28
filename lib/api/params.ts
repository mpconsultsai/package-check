import type { NextRequest } from "next/server";
import { AppError } from "@/lib/api/errors";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import {
  extractPackageName,
  validatePackageName,
  validatePackageNameForEcosystem,
} from "@/lib/packages/validation";

export const parseEcosystem = (
  raw: string | null | undefined,
  fallback: PackageEcosystem = "npm",
): PackageEcosystem => {
  const value = (raw || "").trim().toLowerCase();
  if (value === "pypi" || value === "pip") return "pypi";
  if (value === "nuget") return "nuget";
  if (value === "maven") return "maven";
  if (value === "npm") return "npm";
  return fallback;
};

export const requireEcosystemFromQuery = (
  request: import("next/server").NextRequest,
): PackageEcosystem =>
  parseEcosystem(request.nextUrl.searchParams.get("ecosystem"), "npm");

export const requirePackageNameForEcosystem = (
  raw: string | null | undefined,
  ecosystem: PackageEcosystem,
  missingMessage = "Package name is required",
): string => {
  const packageName = extractPackageName(raw || "");
  if (!packageName) {
    throw new AppError(missingMessage, 400);
  }
  const validation = validatePackageNameForEcosystem(packageName, ecosystem);
  if (!validation.valid) {
    throw new AppError(validation.error || "Invalid package name", 400);
  }
  return packageName;
};

export const requirePackageFromQueryWithEcosystem = (
  request: import("next/server").NextRequest,
  missingMessage = "Package name is required. Use ?package=package-name",
): { packageName: string; ecosystem: PackageEcosystem } => {
  const ecosystem = requireEcosystemFromQuery(request);
  const packageName = requirePackageNameForEcosystem(
    request.nextUrl.searchParams.get("package"),
    ecosystem,
    missingMessage,
  );
  return { packageName, ecosystem };
};

export const requirePackageName = (
  raw: string | null | undefined,
  missingMessage = "Package name is required",
): string => {
  const packageName = extractPackageName(raw || "");
  if (!packageName) {
    throw new AppError(missingMessage, 400);
  }
  const validation = validatePackageName(packageName);
  if (!validation.valid) {
    throw new AppError(validation.error || "Invalid package name", 400);
  }
  return packageName;
};

export const requirePackageFromQuery = (
  request: NextRequest,
  missingMessage = "Package name is required. Use ?package=package-name",
): string =>
  requirePackageName(
    request.nextUrl.searchParams.get("package"),
    missingMessage,
  );

export const requireVersion = (
  raw: string | null | undefined,
  missingMessage = "Version is required",
): string => {
  const version = (raw || "").toString().trim();
  if (!version) throw new AppError(missingMessage, 400);
  return version;
};

export const requireFromTo = (
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
): { from: string; to: string } => {
  const from = (fromRaw || "").trim();
  const to = (toRaw || "").trim();
  if (!from || !to) {
    throw new AppError("Both from and to versions are required", 400);
  }
  return { from, to };
};

export const readJsonBody = async (
  request: NextRequest,
): Promise<Record<string, unknown>> => {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
};
