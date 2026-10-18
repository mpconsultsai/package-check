import type { PackageEcosystem } from "@/lib/packages/package-routes";

export const EXAMPLE_PACKAGES: Record<PackageEcosystem, readonly string[]> = {
  npm: ["react", "lodash", "express"],
  pypi: ["requests", "django", "langgraph"],
  nuget: ["Newtonsoft.Json", "Serilog", "Dapper"],
};
