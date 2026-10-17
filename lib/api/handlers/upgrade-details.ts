import { AppError } from "@/lib/api/errors";
import { jsonOk, withHandler } from "@/lib/api/http";
import {
  requireFromTo,
  requirePackageFromQuery,
} from "@/lib/api/params";
import { loadUpgradeDetails } from "@/lib/upgrade/upgrade-details";

/** GET /api/v1/upgrade?package=&from=&to= */
export const GET = withHandler(
  async (request) => {
    const packageName = requirePackageFromQuery(request);
    const { from, to } = requireFromTo(
      request.nextUrl.searchParams.get("from"),
      request.nextUrl.searchParams.get("to"),
    );

    try {
      const details = await loadUpgradeDetails(packageName, from, to);
      return jsonOk(details);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load upgrade details";
      throw new AppError(message, /not found/i.test(message) ? 404 : 500);
    }
  },
  {
    logLabel: "upgrade",
    fallbackMessage: "Failed to load upgrade details",
  },
);
