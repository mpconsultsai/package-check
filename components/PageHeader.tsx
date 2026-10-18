"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppLogo } from "@/components/AppLogo";
import { GitHubIcon } from "@/components/BrandIcons";
import { useHeaderGithubUrl } from "@/components/header-github";
import { SITE_NAME, SITE_STRAPLINE } from "@/lib/site/site-brand";
import { siteGithubUrl } from "@/lib/site/site-github";
import { smoothNavigate } from "@/lib/prefs/smooth-navigate";

interface PageHeaderProps {
  /** When true (package results), title navigates home with a smooth transition. */
  showHomeLink?: boolean;
}

export function PageHeader({ showHomeLink = false }: PageHeaderProps) {
  const router = useRouter();
  const githubUrl = useHeaderGithubUrl() ?? siteGithubUrl();

  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex items-center justify-between gap-4 border-b-2 border-ink pb-3 sm:pb-4">
        <p className="min-w-0">
          <Link
            href="/"
            className="group inline-flex items-center gap-3"
            aria-label={showHomeLink ? "Back to home" : `${SITE_NAME} home`}
            onClick={(e) => {
              if (!showHomeLink) return;
              e.preventDefault();
              smoothNavigate(() => router.push("/"));
            }}
          >
            <AppLogo className="h-12 w-12 shrink-0 sm:h-14 sm:w-14" />
            <span className="text-3xl font-semibold sm:text-4xl tracking-tight text-ink underline-offset-4 group-hover:underline group-hover:decoration-signal group-hover:decoration-2">
              {SITE_NAME}
            </span>
          </Link>
        </p>
        <nav aria-label="Site" className="flex items-center text-sm">
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
              className="group inline-flex items-center gap-1.5 text-ink"
            >
              <GitHubIcon className="h-4 w-4 shrink-0" />
              <span className="font-medium underline-offset-4 group-hover:underline group-hover:decoration-signal group-hover:decoration-2">
                GitHub
              </span>
            </a>
          )}
        </nav>
      </div>
      {!showHomeLink && (
        <h1 className="mt-6 max-w-3xl text-xl font-medium leading-snug tracking-tight text-balance text-ink sm:mt-10 sm:text-3xl">
          {SITE_STRAPLINE}
        </h1>
      )}
    </header>
  );
}
