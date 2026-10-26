import { fetchNpmDepsDevVersionInsight } from "@/lib/data-fetchers/deps-dev";
import { checkPackageSecurity } from "@/lib/data-fetchers/security";
import { advisoryEcosystem } from "@/lib/packages/package-routes";
import { jsonOk, withHandler } from "@/lib/api/http";
import {
  parseEcosystem,
  readJsonBody,
  requirePackageFromQueryWithEcosystem,
  requirePackageNameForEcosystem,
  requireVersion,
} from "@/lib/api/params";

const securityCheck = async (
  packageName: string,
  version: string,
  ecosystem: import("@/lib/packages/package-routes").PackageEcosystem,
) => {
  const securityEcosystem = advisoryEcosystem(ecosystem);
  const securityPromise = checkPackageSecurity(
    packageName,
    version,
    securityEcosystem,
  );
  const depsDevPromise =
    ecosystem === "npm"
      ? fetchNpmDepsDevVersionInsight(packageName, version).catch(() => null)
      : Promise.resolve(null);
  const [security, depsDev] = await Promise.all([
    securityPromise,
    depsDevPromise,
  ]);
  return jsonOk({
    packageName,
    version,
    ecosystem,
    security,
    ...(depsDev ? { depsDev } : {}),
  });
};

/** GET /api/v1/packages/security?package=&version=&ecosystem= */
export const GET = withHandler(
  async (request) => {
    const { packageName, ecosystem } =
      requirePackageFromQueryWithEcosystem(request);
    const version = requireVersion(
      request.nextUrl.searchParams.get("version"),
      "Version is required. Use ?version=1.0.0",
    );
    return securityCheck(packageName, version, ecosystem);
  },
  {
    logLabel: "packages/security",
    fallbackMessage: "Failed to check package security",
  },
);

/** POST /api/v1/packages/security { packageName, version } */
export const POST = withHandler(
  async (request) => {
    const body = await readJsonBody(request);
    const ecosystem = parseEcosystem(
      typeof body.ecosystem === "string" ? body.ecosystem : undefined,
    );
    const packageName = requirePackageNameForEcosystem(
      typeof body.packageName === "string" ? body.packageName : "",
      ecosystem,
      "packageName is required",
    );
    const version = requireVersion(
      typeof body.version === "string" || typeof body.version === "number"
        ? String(body.version)
        : "",
      "version is required",
    );
    return securityCheck(packageName, version, ecosystem);
  },
  {
    logLabel: "packages/security",
    fallbackMessage: "Failed to check package security",
  },
);
