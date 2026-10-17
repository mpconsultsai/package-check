import { AppError } from "@/lib/api/errors";
import { jsonOk, withHandler } from "@/lib/api/http";
import {
  requireEcosystemFromQuery,
  requirePackageFromQuery,
  requirePackageNameForEcosystem,
} from "@/lib/api/params";
import {
  fetchNugetPackageCards,
  fetchSimilarNugetPackages,
} from "@/lib/data-fetchers/nuget-registry";
import {
  fetchNpmPackageCards,
  fetchNpmPackageData,
  fetchSimilarPackages,
} from "@/lib/data-fetchers/npm-registry";
import { isDotnetInboxPackageId } from "@/lib/nuget/dotnet-platform";
import type { PackageEcosystem } from "@/lib/packages/package-routes";
import {
  normalizeNpmPackageName,
  validatePackageNameForEcosystem,
} from "@/lib/packages/validation";

const FIRST_PAGE_SIZE = 6;
const MORE_PAGE_SIZE = 5;
const RELATED_POOL = 30;

type RelatedCursor = { offset: number };

const parseNameList = (
  param: string | null,
  ecosystem: PackageEcosystem,
): string[] => {
  if (!param) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of param.split(",")) {
    const name =
      ecosystem === "npm" ? normalizeNpmPackageName(raw) : raw.trim();
    const key = name.toLowerCase();
    if (
      !name ||
      seen.has(key) ||
      (ecosystem === "nuget" && isDotnetInboxPackageId(name)) ||
      !validatePackageNameForEcosystem(name, ecosystem).valid
    ) {
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  return names;
};

const encodeCursor = (offset: number): string => {
  const payload: RelatedCursor = { offset };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
};

const decodeCursor = (raw: string | null): number | null => {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as RelatedCursor;
    if (
      typeof parsed?.offset !== "number" ||
      !Number.isFinite(parsed.offset) ||
      parsed.offset < 0
    ) {
      return null;
    }
    return Math.floor(parsed.offset);
  } catch {
    return null;
  }
};

/** GET /api/v1/packages/similar?package=&ecosystem=&keywords=&competitors=&cursor= */
export const GET = withHandler(
  async (request) => {
    const ecosystem = requireEcosystemFromQuery(request);
    const packageName =
      ecosystem === "npm"
        ? requirePackageFromQuery(request)
        : requirePackageNameForEcosystem(
            request.nextUrl.searchParams.get("package"),
            ecosystem,
          );
    const keywordsParam = request.nextUrl.searchParams.get("keywords");
    const keywords = keywordsParam
      ? keywordsParam
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : null;
    const competitorNames = parseNameList(
      request.nextUrl.searchParams.get("competitors"),
      ecosystem,
    ).filter((name) => name.toLowerCase() !== packageName.toLowerCase());
    const cursorParam = request.nextUrl.searchParams.get("cursor");
    const relatedOffset = decodeCursor(cursorParam);

    if (relatedOffset === null) {
      throw new AppError("Invalid cursor", 400);
    }

    if (ecosystem === "pypi") {
      return jsonOk({ packages: [], nextCursor: null });
    }

    let keywordList = keywords;
    if (ecosystem === "npm" && !keywordList?.length) {
      const { data: npmData } = await fetchNpmPackageData(packageName);
      keywordList = npmData.keywords ?? null;
    }

    const isFirstPage = !cursorParam;
    const [competitorCards, related] = await Promise.all([
      isFirstPage && competitorNames.length
        ? ecosystem === "nuget"
          ? fetchNugetPackageCards(competitorNames)
          : fetchNpmPackageCards(competitorNames)
        : Promise.resolve([]),
      ecosystem === "nuget"
        ? fetchSimilarNugetPackages(packageName, keywordList, RELATED_POOL)
        : fetchSimilarPackages(packageName, keywordList, RELATED_POOL),
    ]);

    const competitorSet = new Set(
      competitorCards.map((pkg) => pkg.name.toLowerCase()),
    );
    const relatedOnly = related.filter(
      (pkg) =>
        !competitorSet.has(pkg.name.toLowerCase()) &&
        !(ecosystem === "nuget" && isDotnetInboxPackageId(pkg.name)),
    );

    if (isFirstPage) {
      const competitors = competitorCards.map((pkg) => ({
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
      }));
      const page = [...competitors, ...relatedOnly].slice(0, FIRST_PAGE_SIZE);
      const relatedShown = page.filter(
        (pkg) => !competitorSet.has(pkg.name.toLowerCase()),
      ).length;
      const nextCursor =
        relatedShown < relatedOnly.length ? encodeCursor(relatedShown) : null;

      return jsonOk({ packages: page, nextCursor });
    }

    const page = relatedOnly.slice(
      relatedOffset,
      relatedOffset + MORE_PAGE_SIZE,
    );
    const nextOffset = relatedOffset + page.length;
    const nextCursor =
      page.length > 0 && nextOffset < relatedOnly.length
        ? encodeCursor(nextOffset)
        : null;

    return jsonOk({ packages: page, nextCursor });
  },
  {
    logLabel: "packages/similar",
    fallbackMessage: "Failed to fetch similar packages",
  },
);
