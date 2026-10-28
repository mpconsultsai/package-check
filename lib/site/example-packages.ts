import type { PackageEcosystem } from "@/lib/packages/package-routes";

/** Shown when a download ranking cannot be loaded, and listed in the sitemap. */
export const EXAMPLE_PACKAGES: Record<PackageEcosystem, readonly string[]> = {
  npm: ["react", "lodash", "express"],
  pypi: ["requests", "django", "langgraph"],
  nuget: ["Newtonsoft.Json", "Serilog", "Dapper"],
  maven: [
    "com.google.guava:guava",
    "org.apache.commons:commons-lang3",
    "com.fasterxml.jackson.core:jackson-databind",
  ],
};
