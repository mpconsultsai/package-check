# pkglens

AI-assisted package reviews - security, quality and dependencies at a glance.

pkglens reviews packages from **npm**, **PyPI**, and **NuGet** before you install them. Choose a registry in the search bar, then open a package at `/npm/<name>`, `/pypi/<name>`, or `/nuget/<name>`.

## Features

All three registries:

- **Security** - GitHub Advisory Database for the package version, with patched issues filtered out. Advisories are enriched with CVE identifiers, CISA Known Exploited Vulnerabilities, and EPSS scores when available
- **Health signals** - GitHub stars, forks, issues, and release activity when the package links a GitHub repository; days since the latest release; README deprecation and maintenance warnings
- **Quality score** - A 0–100 score from the signals that are available for that package
- **AI insights** - Recommendation, strengths, concerns, and scores. Gemini 2.5 Flash falls back to Flash-Lite, then Groq
- **Dependencies** - Direct dependencies before you add the package. The chart legend marks peer dependencies on npm only
- **Trends** - Release history and GitHub issue history
- **Watchlist** - Saved packages checked again from the browser
- **Paste a list** - Analyse many packages from a dependency file

npm also includes monthly downloads and download charts, Bundlephobia size, dependents, a transitive dependency graph (deps.dev), OpenSSF Scorecard, related packages, and an upgrade advisor with an optional Groq upgrade brief.

PyPI uses the PyPI JSON API for project metadata, versions, license, and description. It shows distribution size (wheel or sdist), `Requires-Python`, core requirements, extras, and environment markers. Paste analysis accepts `requirements.txt`, `pyproject.toml`, or PEP 508 lines. PyPI reviews do not include download totals, download charts, a transitive dependency tree, related packages, the upgrade advisor, or a peer entry on the dependency chart legend.

NuGet uses the NuGet registration, flat-container, and search APIs. It shows the latest stable version, package size, lifetime downloads, every target framework the package supports, direct package dependencies, and related packages. `System.*` and `Microsoft.*` packages are left out of that related list. Paste analysis accepts `PackageReference` entries from a `.csproj` or `Directory.Packages.props`, or a plain list of package ids. NuGet reviews omit download charts, a transitive dependency tree, the upgrade advisor, and the peer entry on the dependency chart legend. Widely downloaded `System.*` and `Microsoft.*` packages stay recommended when the latest stable release is old and advisories are clear.

The header always shows a GitHub link. Before a review loads it points at this repository. After a package loads it points at that package's repository. Set `NEXT_PUBLIC_GITHUB_REPO` to `owner/name` to change the site link (the default is `mpconsultsai/pkglens`). Set `NEXT_PUBLIC_CONTACT_EMAIL` to show a Contact link in the footer.

## Tech stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **AI**: Google Gemini 2.5 (Flash, then Flash-Lite) and Groq
- **Registries**: npm Registry, PyPI, NuGet
- **Other APIs**: GitHub GraphQL, GitHub Advisory Database, deps.dev and OpenSSF Scorecard (npm), Bundlephobia (npm)

## Getting started

### Prerequisites

- Node.js 20+
- npm
- `GOOGLE_API_KEY` for Gemini
- `GROQ_API_KEY`, `GROQ_MODEL`, and `GROQ_UPGRADE_AGENT_MODEL` for the Groq fallback and the npm upgrade brief
- `GITHUB_TOKEN` (recommended) for advisory lookups and higher GitHub rate limits

### Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Copy the example env file and add your keys:

```bash
cp .env.local.example .env.local
```

4. Start the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

### Tests

```bash
npm test
```

Runs Vitest with coverage. The suite covers `lib/**/*.ts` and fails below 25% lines, functions, branches, and statements. Stay on Node.js 20; this project uses Vitest 3.

## Project structure

```
pkglens/
├── app/
│   ├── api/v1/          # Analysis, packages, upgrade, watchlist, health
│   ├── npm/[name]/      # npm package page
│   ├── pypi/[name]/     # PyPI package page
│   ├── nuget/[name]/    # NuGet package page
│   ├── page.tsx         # Home
│   └── layout.tsx
├── components/          # Search, analysis, and registry-specific panels
└── lib/
    ├── ai/              # Gemini and Groq analysis, upgrade agent
    ├── api/             # Route handlers and path constants
    ├── data-fetchers/   # npm, PyPI, NuGet, GitHub, security, deps.dev
    └── ecosystem-features.ts
```

## API

Routes live under `/api/v1` (`lib/api/paths.ts`). Pass `ecosystem=npm`, `ecosystem=pypi`, or `ecosystem=nuget` (`pip` is accepted as an alias for PyPI). When the parameter is omitted, the ecosystem is npm.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/analysis/ai?package=&ecosystem=` | Metrics plus an AI recommendation. Needs `GOOGLE_API_KEY` |
| GET, POST | `/api/v1/analysis/metrics` | Registry, GitHub, and security data without an LLM |
| GET, POST | `/api/v1/packages/security` | Advisories for one version. Query: `package`, `version`, `ecosystem` |
| GET | `/api/v1/packages/search` | Registry search |
| GET | `/api/v1/packages/dependencies` | Direct dependencies. PyPI responses include extras and markers |
| GET | `/api/v1/packages/dependencies/graph` | Transitive graph for npm |
| GET | `/api/v1/packages/charts` | Download, release, and issue series. Download series are npm-only |
| GET | `/api/v1/packages/similar` | Related packages for npm and NuGet. NuGet omits `System.*` and `Microsoft.*` |
| GET | `/api/v1/packages/dependents` | Packages that depend on an npm package |
| GET | `/api/v1/packages/scorecard` | OpenSSF Scorecard for an npm package's GitHub repo |
| GET | `/api/v1/upgrade` | npm upgrade notes for a version range |
| POST | `/api/v1/upgrade/agent` | Groq upgrade brief for npm |
| POST | `/api/v1/watchlist/check` | Refresh saved packages |
| GET | `/api/v1/health` | Process health and which API keys are set |

```bash
# npm analysis with AI
curl "http://localhost:3000/api/v1/analysis/ai?package=react&ecosystem=npm"

# PyPI analysis without AI
curl "http://localhost:3000/api/v1/analysis/metrics?package=requests&ecosystem=pypi"

# Advisories for one PyPI version
curl "http://localhost:3000/api/v1/packages/security?package=requests&version=2.31.0&ecosystem=pypi"

# NuGet analysis without AI
curl "http://localhost:3000/api/v1/analysis/metrics?package=Newtonsoft.Json&ecosystem=nuget"
```

## Usage

Select **NPM**, **PyPI**, or **NuGet**, enter a package name, and choose **Analyse npm package**, **Analyse PyPI package**, or **Analyse NuGet package**.

A review includes:

- **Package information** - Name, latest version, license, description, and days since the last release
- **Metrics** - Quality score, GitHub stars when a repository is linked, and security counts (critical, high, moderate, low). npm also shows monthly downloads, dependents, and bundle size. PyPI shows distribution size. NuGet shows lifetime downloads, package size, and supported frameworks
- **AI analysis** - `recommended`, `use-with-caution`, or `not-recommended`, with strengths, concerns, and scores
- **Security** - Advisories that affect the selected version, with severity filters and links
- **Dependencies** - npm runtime and peer dependencies, PyPI `Requires-Dist` (core, conditional, and extras), or NuGet package dependencies for the selected target framework. The chart legend includes Peer on npm only
- **Maintenance** - README deprecation language and publish or commit frequency

## Quality score

The score is 0–100. Each available factor contributes up to 25 points, then the total is normalised by the number of factors present. A missing signal is left out rather than scored as zero. PyPI packages usually have no download or dependents count, so those factors are omitted. NuGet uses lifetime downloads: 1 billion or more scores 25.

1. **Adoption** (25) - The higher of GitHub stars and dependents
   - Stars: 5,000+ → 25; 1,000+ → 22; 500+ → 18; 100+ → 14; 10+ → 10; otherwise 5
   - Dependents: 10,000+ → 25; 1,000+ → 22; 100+ → 18; 10+ → 14; otherwise 5
2. **Downloads** (25) - Monthly downloads for npm (10M+ → 25; 1M+ → 20; 100k+ → 15; 10k+ → 10; otherwise 5). Lifetime downloads for NuGet (1B+ → 25; 100M+ → 22; 10M+ → 18; 1M+ → 14; 100k+ → 10; otherwise 5)
3. **Maintenance** (25) - Days since the current version was published
   - Under 90 → 25; under 180 → 20; under 365 → 15; under 730 → 10; otherwise 5
   - `System.*` and `Microsoft.*` packages with at least 100 million lifetime downloads score at least 20 here
4. **Security** (20) - Advisories on the version under review
   - None → 20; 1–2 → 15; 3–5 → 10; 6 or more → 5

## Deployment

On Render, create a **Web Service** (this app serves API routes, so it is not a static site).

- **Build command**: `npm install && npm run build`
- **Start command**: `npm start`
- **Health check path**: `/api/v1/health`
- **Root directory**: leave blank
- **Environment**: `GOOGLE_API_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_UPGRADE_AGENT_MODEL`, and `GITHUB_TOKEN`. Set `NEXT_PUBLIC_SITE_URL` for Open Graph, sitemap, and robots. On Render, `RENDER_EXTERNAL_URL` is used when that variable is unset. Optional: `NEXT_PUBLIC_GITHUB_REPO` and `NEXT_PUBLIC_CONTACT_EMAIL`. Set `MCP_API_KEY` to open the MCP endpoint

The same service exposes MCP at `/api/mcp` (Streamable HTTP). Clients send `Authorization: Bearer <MCP_API_KEY>`. Tools are `search_packages`, `get_package`, `get_security`, `get_dependencies`, and `analyse_package`. `analyse_package` calls the configured LLM. When `MCP_API_KEY` is unset, every MCP request is rejected.

A free Render instance sleeps after about 15 minutes idle. The first request can take about half a minute. While the service is starting, the package page shows **pkglens is starting up** and a **Reload** button. A paid instance stays up. Keep the health check path as `/api/v1/health`.

To run tests during a Render build, use `npm install --include=dev && npm test && npm run build`. A production install skips devDependencies, so Vitest is otherwise omitted. A failed build leaves the previous deploy in place.

## License

MIT
