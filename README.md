# Package Check

Package reviews for npm, PyPI and NuGet: security, upkeep and dependencies in one place.

The same review is available in the browser and over [MCP](#mcp-server). The site is for reading a package. The MCP server is for an agent that needs the same facts as JSON: search, the latest version, advisories, direct dependencies, or a full AI recommendation.

Choose a registry above the search box, then open a package at `/npm/<name>`, `/pypi/<name>`, or `/nuget/<name>`.

![Package Check home page](docs/home.png)

## Features

All three registries:

- **Security** - GitHub Advisory Database for the package version, with patched issues filtered out. Advisories are enriched with CVE identifiers, CISA Known Exploited Vulnerabilities, and EPSS scores when available
- **Health signals** - GitHub stars, forks, issues, and release activity when the package links a GitHub repository; days since the latest release; README deprecation and maintenance warnings
- **Quality score** - A 0–100 score from the signals that are available for that package
- **AI insights** - Recommendation, strengths, concerns, and scores. Gemini 2.5 Flash falls back to Flash-Lite, then Groq
- **Dependencies** - Direct dependencies before you add the package. The view opens on the list (with the count), then the full tree, then the chart. The chart legend marks peer dependencies on npm only
- **Trends** - Release history and GitHub issue history
- **Watchlist** - Saved packages checked again from the browser, at most daily, with Check now. A new version, a named advisory, a new deprecation, or a newly affected npm direct dependency stays listed until you mark it seen. The toolbar dot includes every registry. The list itself is filtered to the registry you are browsing
- **Paste a list** - Analyse many packages from a dependency file
- **Most checked this week** - The home page lists the packages people opened most in the last seven days, and the most recent ones, for the selected registry (needs the database, see below)

The toolbar next to the registry tabs has three text buttons: **Watchlist** (with a count, and a coloured dot when saved packages have updates), **Review package file**, and **Settings** (AI second opinion on or off, light or dark theme, and the npm client used in upgrade commands).

npm also includes monthly downloads and download charts, Bundlephobia size, dependents, a transitive dependency graph (deps.dev), OpenSSF Scorecard (highest scores first, with maintainer notes for any score under 5), related packages, and an upgrade advisor with an optional Groq upgrade brief. Related packages leave out `@types/*`. npm reviews also state a few facts that do not change the quality score: module format, whether TypeScript types ship (or which package an `@types` package is for), signed npm provenance when the registry recorded a CI build, maintainer names, the largest modules in a browser bundle, and which direct dependencies have advisories.

PyPI uses the PyPI JSON API for project metadata, versions, license, and description. It shows distribution size (wheel or sdist), `Requires-Python`, core requirements, extras, and environment markers. Paste analysis accepts `requirements.txt`, `pyproject.toml`, or PEP 508 lines. PyPI reviews do not include download totals, download charts, a transitive dependency tree, related packages, the upgrade advisor, or a peer entry on the dependency chart legend.

NuGet uses the NuGet registration, flat-container, and search APIs. It shows the latest stable version, package size, lifetime downloads, every target framework the package supports, direct package dependencies, and related packages. `System.*` and `Microsoft.*` packages are left out of that related list. Paste analysis accepts `PackageReference` entries from a `.csproj` or `Directory.Packages.props`, or a plain list of package ids. NuGet reviews omit download charts, a transitive dependency tree, the upgrade advisor, and the peer entry on the dependency chart legend. Widely downloaded `System.*` and `Microsoft.*` packages stay recommended when the latest stable release is old and advisories are clear.

The header shows a **GitHub** link. Before a review loads it points at this repository. After a package loads it points at that package's repository. Set `NEXT_PUBLIC_GITHUB_REPO` to `owner/name` to change the site link (the default is `mpconsultsai/package-check`). Set `NEXT_PUBLIC_CONTACT_EMAIL` to show a Contact link in the footer.

## MCP server

The MCP server is the same review pipeline as the site, with a compact JSON result instead of a page. It is a stateless [Streamable HTTP](https://modelcontextprotocol.io) endpoint. Each request builds a server, answers once as JSON, and closes. There is no session.

| | |
| --- | --- |
| URL | `/api/mcp`, and the same handler at `/api/v1/mcp` |
| Auth | `Authorization: Bearer <MCP_API_KEY>` |
| Name | `package-check` |

Set `MCP_API_KEY` to a long random value. When it is unset, every request is rejected with `401` and `{ "error": "Unauthorized" }`. `/api/v1/health` reports `apiKeys.mcp` when the variable is set. Tool calls are stored in `package_searches` with `source` `mcp` when the database is configured.

A Cursor MCP entry for a local server:

```json
{
  "mcpServers": {
    "package-check": {
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer your_mcp_api_key_here"
      }
    }
  }
}
```

Point `url` at the deployed host for a remote agent. The bearer value is the `MCP_API_KEY` on that service.

| Tool | What it returns |
| --- | --- |
| `search_packages` | Up to 8 name, version, and description matches. `query` must be at least 2 characters |
| `get_package` | Latest version, quality score, and advisory counts. No LLM call |
| `get_security` | Advisories for one version (up to 15), with CVE, severity, and known-exploited flags |
| `get_dependencies` | Direct dependencies for the latest version (up to 40). npm includes peers. PyPI includes `Requires-Python` and extras. NuGet includes the target framework |
| `analyse_package` | The `get_package` report plus an AI recommendation, strengths, concerns, and scores. This is the slow tool |

`ecosystem` is `npm` (the default), `pypi`, or `nuget`. `pip` is accepted as PyPI.

For npm, `get_package` and `analyse_package` also return module format, whether types ship, the separate `@types` package when one exists, provenance (repository, commit, and ref when the signed build can be read), maintainers, and bundle composition. Those fields are facts. They do not move `qualityScore`.

`analyse_package` is the only tool that calls Gemini or Groq. Prefer `get_package` when the agent only needs registry and security counts.

## Tech stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4 with a custom paper-and-ink theme (`app/globals.css`), IBM Plex Sans and IBM Plex Mono
- **Database**: Postgres on Supabase through Drizzle and `postgres` (transaction pooler, optional)
- **AI**: Google Gemini 2.5 (Flash, then Flash-Lite) and Groq
- **Registries**: npm Registry, PyPI, NuGet
- **MCP**: Model Context Protocol SDK, Streamable HTTP at `/api/mcp`
- **Other APIs**: GitHub GraphQL, GitHub Advisory Database, deps.dev and OpenSSF Scorecard (npm), Bundlephobia (npm)

## Getting started

### Prerequisites

- Node.js 24+
- npm
- `GOOGLE_API_KEY` for Gemini
- `GROQ_API_KEY`, `GROQ_MODEL`, and `GROQ_UPGRADE_AGENT_MODEL` for the Groq fallback and the npm upgrade brief
- `GITHUB_TOKEN` (recommended) for advisory lookups and higher GitHub rate limits
- `MCP_API_KEY` to open the MCP server. Leave it unset and `/api/mcp` stays closed

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

### Database (optional)

Anonymous package searches and opened package pages are stored in a `package_searches` table. Create it by running `supabase/migrations/20261016000000_package_searches.sql` in the Supabase SQL editor, then set `SUPABASE_URL`, `SUPABASE_DB_HOST` (the transaction pooler host for your project region, for example `aws-0-eu-west-1.pooler.supabase.com`), `SUPABASE_DB_PORT` (`6543`), `SUPABASE_DB_USER` (`postgres.<project-ref>`), and `POSTGRES_DB_PWD`. The `NEXT_PUBLIC_SUPABASE_*` keys are not used.

The home page lists come from this table and refresh every five minutes. A package name only appears there after a registry search has returned it, so a typed URL for a package that does not exist is never listed. Without the database, the app works and the lists are hidden.

### Tests

```bash
npm test
```

Runs Vitest with coverage. The suite covers `lib/**/*.ts` and fails below 25% lines, functions, branches, and statements. Vitest 5 needs Node.js 24 or newer.

## Project structure

The browser and the MCP server call the same functions. A page route renders the response. An MCP tool returns a shorter copy of it. Registry differences live in one feature map, so a PyPI or NuGet review does not grow npm-only panels.

```
package-check/
├── app/
│   ├── api/mcp/         # MCP Streamable HTTP (same handler as /api/v1/mcp)
│   ├── api/v1/          # Analysis, packages, upgrade, watchlist, health
│   ├── npm/[name]/      # npm package page
│   ├── pypi/[name]/     # PyPI package page
│   ├── nuget/[name]/    # NuGet package page
│   ├── page.tsx         # Home (search, most checked, what gets checked)
│   └── layout.tsx       # Skip link, header, main, footer
├── components/          # Search, analysis panels, shared form controls
├── lib/
│   ├── ai/              # Review graph, then Gemini (Flash, Flash-Lite) or Groq
│   ├── api/             # HTTP handlers shared by the Next.js routes
│   ├── data-fetchers/   # npm, PyPI, NuGet, GitHub, advisories, deps.dev, Scorecard
│   ├── db/              # Search log (web, api, or mcp) and the home-page lists
│   ├── mcp/             # Auth, stateless transport, and the five tools
│   ├── packages/        # Analysis response, quality score, npm facts, provenance
│   ├── parse/           # package.json, requirements, and csproj list parsers
│   ├── prefs/           # Theme, registry, AI, and watchlist in the browser
│   ├── site/            # Name, strapline, URL, and fonts
│   ├── upgrade/         # npm upgrade notes and the Groq upgrade brief
│   ├── nuget/           # NuGet version, description, and platform-package rules
│   └── pypi/            # PyPI version and Requires-Dist
└── supabase/
    └── migrations/      # package_searches table
```

The AI review is a short graph: collect the package, then advisories, dependencies, install scripts, and (for npm) Scorecard and the transitive tree, then write the recommendation. `analyse_package` returns the station names it ran as `reviewPath`.

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

Select **npm**, **PyPI**, or **NuGet**, type a package name, and pick a suggestion or press Enter. You can also open a package from **Or try** or from the most checked list on the home page.

A review includes:

- **Package information** - Name, latest version, license, description, and days since the last release
- **Metrics** - Quality score, GitHub stars when a repository is linked, and security counts (critical, high, moderate, low). npm also shows monthly downloads, dependents, and bundle size. PyPI shows distribution size. NuGet shows lifetime downloads, package size, and supported frameworks
- **AI analysis** - `recommended`, `use-with-caution`, or `not-recommended`, with strengths, concerns, and scores
- **Security** - Advisories that affect the selected version, with severity filters and links
- **Scorecard** (npm) - OpenSSF checks for the linked repository, highest scores first, with maintainer notes for any score under 5
- **Dependencies** - The list of direct dependencies is the default view, then the tree, then the chart. npm shows runtime and peer dependencies, PyPI shows `Requires-Dist` (core, conditional, and extras), and NuGet shows package dependencies for the selected target framework. The chart legend includes Peer on npm only
- **Maintenance** - README deprecation language and publish or commit frequency

## Quality score

The score is 0–100. Each available factor contributes up to 25 points, then the total is normalised by the number of factors present. A missing signal is left out rather than scored as zero. PyPI packages usually have no download or dependents count, so those factors are omitted. NuGet uses lifetime downloads: 1 billion or more scores 25.

Module format, missing TypeScript types, bundle size, dependency count, and npm provenance are shown as facts. They do not raise or lower this score.

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

- **Build command**: `rm -rf .next && npm install && npm run build`
- **Start command**: `npm start`
- **Health check path**: `/api/v1/health`
- **Root directory**: leave blank
- **Node**: set `NODE_VERSION` to `24.21.0`. The app requires Node.js 24 or newer.
- **Environment**: `GOOGLE_API_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_UPGRADE_AGENT_MODEL`, and `GITHUB_TOKEN`. Set `NEXT_PUBLIC_SITE_URL` for Open Graph, sitemap, and robots. On Render, `RENDER_EXTERNAL_URL` is used when that variable is unset. Optional: `NEXT_PUBLIC_GITHUB_REPO` and `NEXT_PUBLIC_CONTACT_EMAIL`. Set `MCP_API_KEY` to open the MCP endpoint. Set `SUPABASE_URL`, `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_USER`, and `POSTGRES_DB_PWD` to store anonymous package searches through the transaction pooler. `/api/v1/health` includes `apiKeys.postgres` when the URL, pooler host, and password are set

Set `MCP_API_KEY` on the service to open `/api/mcp`. Clients and tool list are in [MCP server](#mcp-server).

A free Render instance sleeps after about 15 minutes idle. The first request can take about half a minute. While the service is starting, the package page shows **Package Check is starting up** and a **Reload** button. A paid instance stays up. Keep the health check path as `/api/v1/health`.

To run tests during a Render build, use `rm -rf .next && npm install --include=dev && npm test && npm run build`. A production install skips devDependencies, so Vitest is otherwise omitted. A failed build leaves the previous deploy in place. Clearing `.next` avoids a cached server manifest that still omits `/api/mcp`.

## License

MIT
