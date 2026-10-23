const DEFAULT_GITHUB_REPO = "mpconsultsai/package-check";

/** Package Check source repository. Override with NEXT_PUBLIC_GITHUB_REPO. */
export function siteGithubUrl(): string | null {
  const slug =
    process.env.NEXT_PUBLIC_GITHUB_REPO?.trim() || DEFAULT_GITHUB_REPO;
  if (!slug || slug.includes(" ")) return null;
  return `https://github.com/${slug.replace(/^\/+|\/+$/g, "")}`;
}

/** CHANGELOG.md in the site repository. Written on each release deploy. */
export function siteChangelogUrl(): string | null {
  const github = siteGithubUrl();
  if (!github) return null;
  return `${github}/blob/main/CHANGELOG.md`;
}
