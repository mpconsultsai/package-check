import { analyzePackageCached } from "@/lib/packages/analysis-cache";
import { buildAnalysisResponse } from "@/lib/packages/analysis-response";
import { jsonOk, withHandler } from "@/lib/api/http";
import {
  parseEcosystem,
  readJsonBody,
  requirePackageFromQueryWithEcosystem,
  requirePackageNameForEcosystem,
} from "@/lib/api/params";

const analyze = async (
  packageName: string,
  ecosystem: import("@/lib/packages/package-routes").PackageEcosystem,
) => {
  console.log(`Analyzing package (metrics): ${ecosystem}|${packageName}`);
  const packageData = await analyzePackageCached(packageName, ecosystem);
  return jsonOk(buildAnalysisResponse(packageName, packageData, null));
};

/** GET /api/v1/analysis/metrics?package=&ecosystem=npm|pypi */
export const GET = withHandler(async (request) => {
  const { packageName, ecosystem } = requirePackageFromQueryWithEcosystem(request);
  return analyze(packageName, ecosystem);
}, { logLabel: "analysis/metrics", fallbackMessage: "Failed to analyse package" });

/** POST /api/v1/analysis/metrics { packageName, ecosystem? } */
export const POST = withHandler(async (request) => {
  const body = await readJsonBody(request);
  const ecosystem = parseEcosystem(
    typeof body.ecosystem === "string" ? body.ecosystem : undefined,
  );
  const packageName = requirePackageNameForEcosystem(
    typeof body.packageName === "string" ? body.packageName : "",
    ecosystem,
  );
  return analyze(packageName, ecosystem);
}, { logLabel: "analysis/metrics", fallbackMessage: "Failed to analyse package" });
