import { NextResponse } from "next/server";
import { withHandler } from "@/lib/api/http";
import { databaseLogContext, getDb } from "@/lib/db/client";
import { loadPackageActivity } from "@/lib/db/package-activity";

/** GET /api/v1/packages/activity — most / recently checked packages per registry. */
export const GET = withHandler(
  async () => {
    const db = getDb();
    const connection = databaseLogContext();
    const { activity, matchedRows, error } = await loadPackageActivity(db);
    return NextResponse.json(
      {
        activity,
        matchedRows,
        databaseConfigured: connection.configured,
        connection: {
          host: connection.host,
          port: connection.port,
          user: connection.user,
        },
        ...(error ? { error } : {}),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  },
  {
    logLabel: "packages/activity",
    fallbackMessage: "Failed to load package activity",
  },
);
