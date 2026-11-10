import { jsonOk, withHandler } from "@/lib/api/http";
import { databaseLogContext, getDb } from "@/lib/db/client";
import { loadPackageActivity } from "@/lib/db/package-activity";

/** GET /api/v1/packages/activity — most / recently checked packages per registry. */
export const GET = withHandler(
  async () => {
    const db = getDb();
    const activity = await loadPackageActivity(db);
    return jsonOk({
      activity,
      databaseConfigured: databaseLogContext().configured,
    });
  },
  {
    logLabel: "packages/activity",
    fallbackMessage: "Failed to load package activity",
  },
);
