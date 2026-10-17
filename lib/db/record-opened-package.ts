import { after } from "next/server";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { clientMetadata } from "@/lib/db/client-metadata";
import { recordPackageSearch } from "@/lib/db/package-searches";

type HeaderSource = {
  get(name: string): string | null;
};

/** Store the package opened from a page request, after the response is sent. */
export function recordOpenedPackage(
  ecosystem: PackageEcosystem,
  packageName: string,
  requestHeaders?: HeaderSource,
): void {
  const query = packageName.trim();
  if (query.length < 2) return;
  const client = requestHeaders ? clientMetadata(requestHeaders) : {};
  after(() =>
    recordPackageSearch({
      ecosystem,
      query,
      resultNames: [query],
      source: "web",
      metadata: { page: true, ...client },
    }),
  );
}
