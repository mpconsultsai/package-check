import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { clientMetadata } from "@/lib/db/client-metadata";
import { recordPackageSearch } from "@/lib/db/package-searches";

type HeaderSource = {
  get(name: string): string | null;
};

/**
 * Store a package that was successfully opened (metrics loaded).
 * Awaited by the metrics handler so serverless runtimes do not freeze
 * before the insert finishes (fire-and-forget left activity lists empty).
 */
export const recordOpenedPackage = async (
  ecosystem: PackageEcosystem,
  packageName: string,
  requestHeaders?: HeaderSource,
): Promise<void> => {
  const query = packageName.trim();
  if (query.length < 2) return;
  const client = requestHeaders ? clientMetadata(requestHeaders) : {};
  await recordPackageSearch({
    ecosystem,
    query,
    resultNames: [query],
    source: "web",
    metadata: { page: true, resolved: true, ...client },
  });
};
