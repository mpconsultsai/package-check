import type { Metadata } from "next";
import { WhatWeCheck } from "@/components/WhatWeCheck";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site-brand";
import { getSiteUrl } from "@/lib/site-url";

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

export default function Home() {
  return (
    <section aria-labelledby="home-features-heading">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <h2 id="home-features-heading" className="sr-only">
        What {SITE_NAME} shows for each package
      </h2>
      <WhatWeCheck />
    </section>
  );
}
