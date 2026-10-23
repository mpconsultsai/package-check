import { SITE_NAME } from "@/lib/site/site-brand";
import { siteChangelogUrl } from "@/lib/site/site-github";

export function SiteFooter() {
  const year = new Date().getFullYear();
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  const release = process.env.NEXT_PUBLIC_RELEASE?.trim();
  const changelogUrl = siteChangelogUrl();

  return (
    <footer className="mt-16 border-t-2 border-ink pt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono sm:block sm:space-y-1">
          <p className="whitespace-nowrap text-sm text-ink">
            © {year} {SITE_NAME}
            {release ? (
              <>
                {" "}
                ·{" "}
                {changelogUrl ? (
                  <a
                    href={changelogUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link"
                    title="Changelog on GitHub"
                  >
                    v{release}
                  </a>
                ) : (
                  <span>v{release}</span>
                )}
              </>
            ) : null}
          </p>
          {contact && (
            <nav aria-label="Footer">
              <a
                href={`mailto:${contact}`}
                className="link"
              >
                Contact
              </a>
            </nav>
          )}
        </div>
        <div className="max-w-2xl space-y-2">
          <p>
            Analysis uses public npm, PyPI, NuGet, GitHub, and security advisory data.
            Optional AI summaries are{" "}
            <strong className="font-medium text-gray-700 dark:text-gray-300">advisory only</strong>{". They are not legal, security, or procurement advice. Verify before you ship. When AI is on, the package name and the public figures in the review are sent to Google Gemini. If Gemini is unavailable, that same request is sent to Groq."}
          </p>
          <p>
            We do not require an account. Package names you search may be logged
            for rate limiting and reliability. Registry and AI APIs may impose
            their own limits.
          </p>
        </div>
      </div>
    </footer>
  );
}
