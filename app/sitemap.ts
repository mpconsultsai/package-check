import type { MetadataRoute } from "next";
import { EXAMPLE_PACKAGES } from "@/lib/site/example-packages";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import { getSiteUrl } from "@/lib/site/site-url";

function packageUrl(ecosystem: PackageEcosystem, name: string): string {
  return `${getSiteUrl()}/${ecosystem}/${encodeURIComponent(name)}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const home = getSiteUrl();
  const examples = (
    Object.entries(EXAMPLE_PACKAGES) as [PackageEcosystem, readonly string[]][]
  ).flatMap(([ecosystem, names]) =>
    names.map((name) => ({
      url: packageUrl(ecosystem, name),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  );

  return [
    {
      url: home,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...examples,
  ];
}
