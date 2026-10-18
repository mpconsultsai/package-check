import type { Metadata } from "next";
import { PackageActivity } from "@/components/PackageActivity";
import { WhatWeCheck } from "@/components/WhatWeCheck";
import { loadPackageActivity } from "@/lib/db/package-activity";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site/site-brand";
import { getSiteUrl } from "@/lib/site/site-url";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: SITE_NAME,
      url: getSiteUrl(),
      description: SITE_DESCRIPTION,
      inLanguage: "en-GB",
    },
    {
      "@type": "WebApplication",
      name: SITE_NAME,
      url: getSiteUrl(),
      description: SITE_DESCRIPTION,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any",
      inLanguage: "en-GB",
    },
  ],
};

export const revalidate = 300;

export default async function Home() {
  const activity = await loadPackageActivity();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PackageActivity activity={activity} />
      <WhatWeCheck />
    </>
  );
}
