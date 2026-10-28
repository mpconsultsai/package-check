import axios from "axios";
import {
  publicRegistryMessage,
} from "@/lib/utils/error-message";
import { validatePackageNameForEcosystem } from "@/lib/packages/validation";
import { sanitizeDescription } from "@/lib/packages/sanitize";
import type { NpmPackageData } from "@/lib/types/package-data";
import type { DistributionSizeInfo } from "@/lib/data-fetchers/pypi-distribution-size";
import {
  compareMavenVersions,
  isMavenPrerelease,
} from "@/lib/maven/maven-version";

const SOLR_SEARCH = "https://search.maven.org/solrsearch/select";
const REPO1 = "https://repo1.maven.org/maven2";

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "pkglens/1.0",
};

export type MavenSearchResult = {
  name: string;
  description: string;
  version: string;
};

export type MavenCoordinate = {
  groupId: string;
  artifactId: string;
};

type SolrDoc = {
  id?: string;
  g?: string;
  a?: string;
  v?: string;
  latestVersion?: string;
  timestamp?: number;
  versionCount?: number;
};

type SolrResponse = {
  response?: {
    numFound?: number;
    docs?: SolrDoc[];
  };
};

function coordKey(groupId: string, artifactId: string): string {
  return `${groupId}:${artifactId}`;
}

/** Parse `groupId:artifactId` (optional trailing `:version`). */
export function parseMavenCoordinate(
  input: string,
): MavenCoordinate | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length < 2) return null;
  const groupId = parts[0]?.trim();
  const artifactId = parts[1]?.trim();
  if (!groupId || !artifactId) return null;
  return { groupId, artifactId };
}

function groupPath(groupId: string): string {
  return groupId.trim().split(".").map(encodeURIComponent).join("/");
}

function artifactBaseUrl(groupId: string, artifactId: string): string {
  return `${REPO1}/${groupPath(groupId)}/${encodeURIComponent(artifactId.trim())}`;
}

async function solrSelect(params: Record<string, string | number>): Promise<{
  docs: SolrDoc[];
  numFound: number;
}> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await axios.get<SolrResponse>(SOLR_SEARCH, {
        headers: HEADERS,
        params: { wt: "json", ...params },
        timeout: 12_000,
      });
      return {
        docs: response.data.response?.docs ?? [],
        numFound: response.data.response?.numFound ?? 0,
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Maven Central search failed");
}

async function resolveCoordinate(packageName: string): Promise<MavenCoordinate> {
  const parsed = parseMavenCoordinate(packageName);
  if (parsed) return parsed;

  const { docs } = await solrSelect({
    q: packageName.trim(),
    rows: 8,
  });
  const exact = docs.find(
    (doc) =>
      doc.a?.toLowerCase() === packageName.trim().toLowerCase() && doc.g,
  );
  const hit = exact ?? docs.find((doc) => doc.g && doc.a);
  if (!hit?.g || !hit.a) {
    throw new Error(`Package "${packageName}" not found on Maven Central`);
  }
  return { groupId: hit.g, artifactId: hit.a };
}

function pickLatestVersion(versions: string[]): string {
  const stable = versions.filter((version) => !isMavenPrerelease(version));
  const pool = stable.length > 0 ? stable : versions;
  return [...pool].sort((a, b) => compareMavenVersions(b, a))[0] ?? "Unknown";
}

function xmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"),
  );
  const value = match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return value || undefined;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Project-level URL / SCM, ignoring nested plugin and license URLs. */
function projectHead(pom: string): string {
  return pom.split(/<(dependencies|dependencyManagement|build|profiles|reporting)\b/i)[0] ?? pom;
}

function repositoryFromPom(pom: string): NpmPackageData["repository"] | undefined {
  const head = projectHead(pom);
  const scmBlock = xmlTag(head, "scm");
  const scmUrl = scmBlock ? xmlTag(scmBlock, "url") : undefined;
  const url = scmUrl || xmlTag(head, "url");
  if (!url) return undefined;
  return { type: "git", url };
}

function homepageFromPom(pom: string): string | undefined {
  return xmlTag(projectHead(pom), "url");
}

function propertiesFromPom(pom: string): Record<string, string> {
  const block = xmlTag(pom, "properties");
  if (!block) return {};
  const props: Record<string, string> = {};
  const tagRe = /<([A-Za-z_][\w.-]*)>([^<]*)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(block)) !== null) {
    const key = match[1]?.trim();
    const value = match[2]?.trim();
    if (key && value !== undefined) props[key] = value;
  }
  return props;
}

type PomPropertyContext = {
  groupId: string;
  artifactId: string;
  version: string;
  props: Record<string, string>;
};

/** Resolve `${project.groupId}` / `${foo.version}` style POM placeholders. */
function resolvePomValue(
  raw: string | undefined,
  ctx: PomPropertyContext,
): string {
  if (!raw) return "";
  return raw.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    switch (key) {
      case "project.groupId":
      case "pom.groupId":
      case "groupId":
        return ctx.groupId;
      case "project.artifactId":
      case "pom.artifactId":
      case "artifactId":
        return ctx.artifactId;
      case "project.version":
      case "pom.version":
      case "version":
        return ctx.version;
      default:
        return ctx.props[key] ?? `\${${key}}`;
    }
  });
}

function dependenciesFromPom(
  pom: string,
  ctx: Omit<PomPropertyContext, "props">,
): Record<string, string> | undefined {
  const depsBlock = xmlTag(pom, "dependencies");
  if (!depsBlock) return undefined;

  const fullCtx: PomPropertyContext = {
    ...ctx,
    props: propertiesFromPom(pom),
  };
  const dependencies: Record<string, string> = {};
  const depRe = /<dependency>([\s\S]*?)<\/dependency>/gi;
  let match: RegExpExecArray | null;
  while ((match = depRe.exec(depsBlock)) !== null) {
    const block = match[1];
    const groupId = resolvePomValue(xmlTag(block, "groupId"), fullCtx);
    const artifactId = resolvePomValue(xmlTag(block, "artifactId"), fullCtx);
    const versionRaw = resolvePomValue(xmlTag(block, "version"), fullCtx);
    const scope = (xmlTag(block, "scope") ?? "compile").toLowerCase();
    const optional = (xmlTag(block, "optional") ?? "").toLowerCase() === "true";
    if (!groupId || !artifactId) continue;
    // Skip coords we still cannot resolve (e.g. parent-only properties).
    if (groupId.includes("${") || artifactId.includes("${")) continue;
    if (scope === "test" || scope === "provided" || optional) continue;
    const version =
      !versionRaw || versionRaw.includes("${") ? "*" : versionRaw;
    dependencies[coordKey(groupId, artifactId)] = version;
  }
  return Object.keys(dependencies).length > 0 ? dependencies : undefined;
}

async function loadVersions(
  groupId: string,
  artifactId: string,
): Promise<{ versions: string[]; time: Record<string, string>; latestHint?: string }> {
  const time: Record<string, string> = {};
  const versions = new Set<string>();
  let latestHint: string | undefined;

  // Page Solr gav results for publish timestamps (release charts).
  // Keep page size modest — large rows= calls often hang on Central.
  try {
    const pageSize = 20;
    let start = 0;
    let numFound = Number.POSITIVE_INFINITY;
    while (start < numFound && start < 400) {
      try {
        const page = await solrSelect({
          q: `g:${groupId} AND a:${artifactId}`,
          core: "gav",
          rows: pageSize,
          start,
        });
        numFound = page.numFound;
        if (page.docs.length === 0) break;
        for (const doc of page.docs) {
          const version = doc.v?.trim();
          if (!version) continue;
          versions.add(version);
          if (
            typeof doc.timestamp === "number" &&
            Number.isFinite(doc.timestamp)
          ) {
            time[version] = new Date(doc.timestamp).toISOString();
          }
        }
        start += page.docs.length;
        if (page.docs.length < pageSize) break;
      } catch (error) {
        // Keep any pages already loaded; metadata can still list versions.
        console.warn(
          `Maven Central version page failed for ${groupId}:${artifactId} at ${start}:`,
          error instanceof Error ? error.message : error,
        );
        break;
      }
    }
  } catch {
    // Fall through to maven-metadata.xml
  }

  try {
    const metaUrl = `${artifactBaseUrl(groupId, artifactId)}/maven-metadata.xml`;
    const response = await axios.get<string>(metaUrl, {
      headers: { "User-Agent": HEADERS["User-Agent"], Accept: "application/xml" },
      responseType: "text",
      timeout: 15_000,
      validateStatus: (status) => status === 200 || status === 404,
    });
    if (response.status === 200) {
      const xml = String(response.data);
      latestHint =
        xmlTag(xmlTag(xml, "versioning") ?? "", "release") ||
        xmlTag(xmlTag(xml, "versioning") ?? "", "latest") ||
        undefined;
      const versioning = xmlTag(xml, "versioning") ?? "";
      const versionsBlock = xmlTag(versioning, "versions") ?? "";
      const versionRe = /<version>([^<]+)<\/version>/gi;
      let match: RegExpExecArray | null;
      while ((match = versionRe.exec(versionsBlock)) !== null) {
        const version = match[1]?.trim();
        if (version) versions.add(version);
      }
    }
  } catch {
    // Ignore metadata failures when Solr already returned versions.
  }

  if (versions.size === 0) {
    throw new Error(
      `Package "${coordKey(groupId, artifactId)}" not found on Maven Central`,
    );
  }

  return { versions: [...versions], time, latestHint };
}

async function fetchPom(
  groupId: string,
  artifactId: string,
  version: string,
): Promise<string> {
  const url = `${artifactBaseUrl(groupId, artifactId)}/${encodeURIComponent(version)}/${encodeURIComponent(artifactId)}-${encodeURIComponent(version)}.pom`;
  const response = await axios.get<string>(url, {
    headers: { "User-Agent": HEADERS["User-Agent"], Accept: "application/xml" },
    responseType: "text",
    timeout: 15_000,
    validateStatus: (status) => status === 200 || status === 404,
  });
  if (response.status !== 200) return "";
  return String(response.data);
}

async function fetchJarSize(
  groupId: string,
  artifactId: string,
  version: string,
): Promise<DistributionSizeInfo | null> {
  const filename = `${artifactId}-${version}.jar`;
  const url = `${artifactBaseUrl(groupId, artifactId)}/${encodeURIComponent(version)}/${encodeURIComponent(filename)}`;
  try {
    const response = await axios.head(url, {
      headers: { "User-Agent": HEADERS["User-Agent"] },
      timeout: 10_000,
      validateStatus: (status) => status === 200 || status === 404,
    });
    const contentLength = Number(response.headers?.["content-length"]);
    if (response.status === 200 && Number.isFinite(contentLength) && contentLength > 0) {
      return { bytes: contentLength, packagetype: "jar", filename };
    }
  } catch {
    // Size is optional.
  }
  return null;
}

export async function fetchMavenPackageData(packageName: string): Promise<{
  data: NpmPackageData;
  readme: string | null;
  distributionSize: DistributionSizeInfo | null;
}> {
  try {
    const { groupId, artifactId } = await resolveCoordinate(packageName);
    const name = coordKey(groupId, artifactId);
    const { versions, time, latestHint } = await loadVersions(groupId, artifactId);
    const version =
      (latestHint && versions.includes(latestHint) ? latestHint : null) ||
      pickLatestVersion(versions);
    // Metadata can list versions Solr has not indexed yet — keep them selectable.
    for (const entry of versions) {
      if (!time[entry]) time[entry] = "";
    }

    const [pom, distributionSize] = await Promise.all([
      fetchPom(groupId, artifactId, version),
      fetchJarSize(groupId, artifactId, version),
    ]);

    const descriptionRaw = pom ? xmlTag(pom, "description") : undefined;
    const description = descriptionRaw
      ? sanitizeDescription(stripHtml(descriptionRaw))
      : `${groupId}:${artifactId}`;
    const licensesBlock = pom ? xmlTag(pom, "licenses") ?? "" : "";
    const licenseName =
      xmlTag(licensesBlock, "name") ||
      xmlTag(licensesBlock, "url") ||
      undefined;
    const author =
      (pom &&
        (xmlTag(xmlTag(pom, "developers") ?? "", "name") ||
          xmlTag(pom, "organization"))) ||
      undefined;

    return {
      data: {
        name,
        version,
        description: description || `${groupId}:${artifactId}`,
        license: licenseName,
        repository: pom ? repositoryFromPom(pom) : undefined,
        homepage: pom ? homepageFromPom(pom) : undefined,
        dependencies: pom
          ? dependenciesFromPom(pom, { groupId, artifactId, version })
          : undefined,
        author: author ? stripHtml(author) : undefined,
        time: time as NpmPackageData["time"],
        distTags: { latest: version },
      },
      readme: null,
      distributionSize,
    };
  } catch (error: unknown) {
    if (!(error instanceof Error && /not found/i.test(error.message))) {
      console.error("Failed to fetch Maven data:", error);
    }
    throw new Error(publicRegistryMessage(error, "Maven Central"));
  }
}

export async function searchMavenPackages(
  query: string,
  limit: number = 8,
): Promise<MavenSearchResult[]> {
  const text = query.trim();
  if (text.length < 2) return [];

  try {
    const parsed = parseMavenCoordinate(text);
    const q = parsed
      ? `g:${parsed.groupId} AND a:${parsed.artifactId}`
      : text.includes(":")
        ? text
        : text;

    const { docs } = await solrSelect({ q, rows: limit });
    const results: MavenSearchResult[] = [];
    const seen = new Set<string>();

    for (const doc of docs) {
      if (!doc.g || !doc.a) continue;
      const name = coordKey(doc.g, doc.a);
      if (!validatePackageNameForEcosystem(name, "maven").valid) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        name,
        description: doc.g,
        version: doc.latestVersion || doc.v || "Unknown",
      });
      if (results.length >= limit) break;
    }
    return results;
  } catch (error: unknown) {
    console.warn("Maven search failed:", error);
    return [];
  }
}

export async function fetchMavenPackageCards(
  names: string[],
): Promise<MavenSearchResult[]> {
  const cards = await Promise.all(
    names.map(async (name) => {
      if (!validatePackageNameForEcosystem(name, "maven").valid) return null;
      try {
        const { data } = await fetchMavenPackageData(name);
        return {
          name: data.name,
          description: data.description || data.name,
          version: data.version || "Unknown",
        };
      } catch {
        return null;
      }
    }),
  );
  return cards.filter((card): card is MavenSearchResult => card !== null);
}

/** Related artifacts sharing a groupId prefix. */
export async function fetchSimilarMavenPackages(
  packageId: string,
  limit: number = 30,
): Promise<MavenSearchResult[]> {
  try {
    const { groupId, artifactId } = await resolveCoordinate(packageId);
    const prefix = groupId.split(".").slice(0, 2).join(".");
    const { docs } = await solrSelect({
      q: prefix ? `g:${prefix}*` : groupId,
      rows: Math.min(Math.max(limit * 2, 20), 40),
    });
    const current = coordKey(groupId, artifactId).toLowerCase();
    const results: MavenSearchResult[] = [];
    const seen = new Set<string>([current]);

    for (const doc of docs) {
      if (!doc.g || !doc.a) continue;
      const name = coordKey(doc.g, doc.a);
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      if (!validatePackageNameForEcosystem(name, "maven").valid) continue;
      seen.add(key);
      results.push({
        name,
        description: doc.g,
        version: doc.latestVersion || doc.v || "Unknown",
      });
      if (results.length >= limit) break;
    }
    return results;
  } catch {
    return [];
  }
}
