import { AppError } from "@/lib/api/errors";
import { jsonOk, withHandler } from "@/lib/api/http";
import { readJsonBody, requirePackageName } from "@/lib/api/params";
import { loadReversePeerFits } from "@/lib/upgrade/project-reverse-peer-fit";
import semver from "semver";

/** POST /api/v1/upgrade/project-fit — reverse peer scan for project context. */
export const POST = withHandler(
  async (request) => {
    const body = await readJsonBody(request);
    const packageName = requirePackageName(
      typeof body.packageName === "string"
        ? body.packageName
        : typeof body.package === "string"
          ? body.package
          : "",
    );
    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!to || !semver.valid(to)) {
      throw new AppError("A concrete target version (to) is required", 400);
    }
    const projectDepsRaw = body.projectDeps;
    if (
      !projectDepsRaw ||
      typeof projectDepsRaw !== "object" ||
      Array.isArray(projectDepsRaw)
    ) {
      throw new AppError("projectDeps object is required", 400);
    }

    const projectDeps: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      projectDepsRaw as Record<string, unknown>,
    )) {
      if (typeof value !== "string" || !value.trim() || !name.trim()) continue;
      projectDeps[name.trim()] = value.trim();
      if (Object.keys(projectDeps).length >= 200) break;
    }

    const result = await loadReversePeerFits({
      upgradePackage: packageName,
      targetVersion: to,
      projectDeps,
      signal: request.signal,
    });

    return jsonOk({
      packageName,
      to,
      reversePeers: result.fits,
      scanned: result.scanned,
      truncated: result.truncated,
    });
  },
  {
    logLabel: "upgrade/project-fit",
    fallbackMessage: "Failed to check project peer fit",
  },
);
