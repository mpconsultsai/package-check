import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { clientMetadata } from "@/lib/db/client-metadata";
import { recordPackageSearch } from "@/lib/db/package-searches";

type HeaderSource = {
  get(name: string): string | null;
};

/**
 * Store a package that was successfully opened (metrics loaded).
 * Starts the insert immediately — does not use `after()`, which is unreliable
 * on some hosts and left the home-page activity lists empty in production.
 */
export function recordOpenedPackage(
  ecosystem: PackageEcosystem,
  packageName: string,
  requestHeaders?: HeaderSource,
): void {
  const query = packageName.trim();
  if (query.length < 2) return;
  const client = requestHeaders ? clientMetadata(requestHeaders) : {};
  void recordPackageSearch({
    ecosystem,
    query,
    resultNames: [query],
    source: "web",
    metadata: { page: true, resolved: true, ...client },
  });
}
