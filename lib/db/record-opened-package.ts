import { after } from "next/server";
import type { PackageEcosystem } from "@/lib/package-routes";
import { recordPackageSearch } from "@/lib/db/package-searches";

/** Store the package opened from a page request, after the response is sent. */
export function recordOpenedPackage(
  ecosystem: PackageEcosystem,
  packageName: string,
): void {
  const query = packageName.trim();
  if (query.length < 2) return;
  after(() =>
    recordPackageSearch({
      ecosystem,
      query,
      resultNames: [query],
      source: "web",
      metadata: { page: true },
    }),
  );
}
