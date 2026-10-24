import { jsonOk, withHandler } from "@/lib/api/http";
import { parseEcosystem } from "@/lib/api/params";
import { randomPopularPackages } from "@/lib/site/popular-packages";

/** GET /api/v1/packages/examples?ecosystem= */
export const GET = withHandler(
  async (request) => {
    const ecosystem = parseEcosystem(
      request.nextUrl.searchParams.get("ecosystem"),
    );
    const packages = await randomPopularPackages(ecosystem);
    return jsonOk({ packages });
  },
  {
    logLabel: "packages/examples",
    fallbackMessage: "Failed to load example packages",
  },
);
