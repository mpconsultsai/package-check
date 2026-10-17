import { analyzePackageCached } from "@/lib/packages/analysis-cache";
import { buildAnalysisResponse } from "@/lib/packages/analysis-response";
import { analyzePackageWithAI } from "@/lib/ai/analyzer";
import { jsonOk, withHandler } from "@/lib/api/http";
import {
  parseEcosystem,
  readJsonBody,
  requirePackageFromQueryWithEcosystem,
  requirePackageNameForEcosystem,
} from "@/lib/api/params";

const analyzeAi = async (
  packageName: string,
  ecosystem: import("@/lib/packages/package-routes").PackageEcosystem,
) => {
  console.log(`Analyzing package with AI: ${ecosystem}|${packageName}`);
  const t0 = Date.now();
  const packageData = await analyzePackageCached(packageName, ecosystem);
  const dataMs = Date.now() - t0;

  let aiAnalysis = null;
  let llmMs = 0;
  try {
    const t1 = Date.now();
    aiAnalysis = await analyzePackageWithAI(packageData);
    llmMs = Date.now() - t1;
  } catch (error: unknown) {
    console.error("AI analysis failed:", error);
    packageData.errors = {
      ...packageData.errors,
      ai: error instanceof Error ? error.message : "AI analysis failed",
    };
  }

  const totalMs = Date.now() - t0;
  console.log(
    `AI timing ${packageName}: dataMs=${dataMs} llmMs=${llmMs} provider=${aiAnalysis?.model ?? "none"} totalMs=${totalMs}`,
  );

  return jsonOk(buildAnalysisResponse(packageName, packageData, aiAnalysis));
};

/** GET /api/v1/analysis/ai?package= */
export const GET = withHandler(
  async (request) => {
    const { packageName, ecosystem } =
      requirePackageFromQueryWithEcosystem(request);
    return analyzeAi(packageName, ecosystem);
  },
  {
    logLabel: "analysis/ai",
    fallbackMessage: "Failed to analyse package",
  },
);

/** POST /api/v1/analysis/ai { packageName } */
export const POST = withHandler(
  async (request) => {
    const body = await readJsonBody(request);
    const ecosystem = parseEcosystem(
      typeof body.ecosystem === "string" ? body.ecosystem : undefined,
    );
    const packageName = requirePackageNameForEcosystem(
      typeof body.packageName === "string" ? body.packageName : "",
      ecosystem,
    );
    return analyzeAi(packageName, ecosystem);
  },
  {
    logLabel: "analysis/ai",
    fallbackMessage: "Failed to analyse package",
  },
);
