const DEPS_DEV_API = "https://api.deps.dev/v3";
const GRAPH_CACHE_MS = 30 * 60 * 1000;
const MAX_ADVISORY_LOOKUPS = 48;

type DepsDevVersionKey = {
  system: string;
  name: string;
  version: string;
};

type DepsDevGraphNode = {
  versionKey: DepsDevVersionKey;
  relation: string;
};

type DepsDevGraphResponse = {
  nodes?: DepsDevGraphNode[];
  edges?: { fromNode: number; toNode: number; requirement?: string }[];
  error?: string;
};

export type TransitiveDepNode = {
  name: string;
  version: string;
  relation: "SELF" | "DIRECT" | "INDIRECT" | "OTHER";
  advisoryCount: number;
  advisoryIds: string[];
};

export type TransitiveDepEdge = {
  from: string;
  to: string;
  requirement?: string;
};

export type TransitiveDependencyGraph = {
  packageName: string;
  version: string;
  nodes: TransitiveDepNode[];
  edges: TransitiveDepEdge[];
  stats: {
    total: number;
    direct: number;
    indirect: number;
    withAdvisories: number;
  };
  depsDevUrl: string;
};

const graphCache = new Map<
  string,
  { expires: number; data: TransitiveDependencyGraph }
>();

function nodeId(key: DepsDevVersionKey): string {
  return `${key.name}@${key.version}`;
}

function encodePackagePath(name: string): string {
  return encodeURIComponent(name);
}

function normalizeRelation(raw: string): TransitiveDepNode["relation"] {
  if (raw === "SELF" || raw === "DIRECT" || raw === "INDIRECT") return raw;
  return "OTHER";
}

const RELATION_RANK: Record<TransitiveDepNode["relation"], number> = {
  SELF: 0,
  DIRECT: 1,
  INDIRECT: 2,
  OTHER: 3,
};

function mergeRelation(
  a: TransitiveDepNode["relation"],
  b: TransitiveDepNode["relation"],
): TransitiveDepNode["relation"] {
  return RELATION_RANK[a] <= RELATION_RANK[b] ? a : b;
}

/** deps.dev can repeat the same versionKey; collapse to one node and remap edges. */
function dedupeGraphNodes(rawNodes: DepsDevGraphNode[]): {
  nodes: Omit<TransitiveDepNode, "advisoryCount" | "advisoryIds">[];
  rawIndexToCanonical: number[];
} {
  const nodes: Omit<TransitiveDepNode, "advisoryCount" | "advisoryIds">[] = [];
  const keyToCanonical = new Map<string, number>();
  const rawIndexToCanonical: number[] = [];

  for (let i = 0; i < rawNodes.length; i++) {
    const raw = rawNodes[i];
    const key = nodeId(raw.versionKey);
    let canonical = keyToCanonical.get(key);
    if (canonical === undefined) {
      canonical = nodes.length;
      keyToCanonical.set(key, canonical);
      nodes.push({
        name: raw.versionKey.name,
        version: raw.versionKey.version,
        relation: normalizeRelation(raw.relation),
      });
    } else {
      nodes[canonical].relation = mergeRelation(
        nodes[canonical].relation,
        normalizeRelation(raw.relation),
      );
    }
    rawIndexToCanonical[i] = canonical;
  }

  return { nodes, rawIndexToCanonical };
}

function dedupeEdges(edges: TransitiveDepEdge[]): TransitiveDepEdge[] {
  const seen = new Set<string>();
  const out: TransitiveDepEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\t${edge.to}\t${edge.requirement ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

async function fetchVersionAdvisories(
  key: DepsDevVersionKey,
): Promise<string[]> {
  const url = `${DEPS_DEV_API}/systems/npm/packages/${encodePackagePath(key.name)}/versions/${encodeURIComponent(key.version)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      advisoryKeys?: { id?: string }[];
    };
    return (payload.advisoryKeys ?? [])
      .map((a) => a.id?.trim())
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

const DIRECT_ADVISORY_CAP = 32;

type BareDependencyGraph = {
  packageName: string;
  version: string;
  nodes: TransitiveDepNode[];
  edges: TransitiveDepEdge[];
};

const bareGraphCache = new Map<
  string,
  { expires: number; data: BareDependencyGraph }
>();

async function loadBareDependencyGraph(
  packageName: string,
  version: string,
): Promise<BareDependencyGraph> {
  const cacheKey = `${packageName.toLowerCase()}|${version}`;
  const cached = bareGraphCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const url = `${DEPS_DEV_API}/systems/npm/packages/${encodePackagePath(packageName)}/versions/${encodeURIComponent(version)}:dependencies`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`deps.dev graph unavailable (${response.status})`);
  }

  const payload = (await response.json()) as DepsDevGraphResponse;
  if (payload.error) throw new Error(payload.error);

  const rawNodes = payload.nodes ?? [];
  const { nodes: dedupedBase, rawIndexToCanonical } = dedupeGraphNodes(rawNodes);
  const nodes: TransitiveDepNode[] = dedupedBase.map((node) => ({
    ...node,
    advisoryCount: 0,
    advisoryIds: [],
  }));
  const idByCanonical = nodes.map((node) =>
    nodeId({ system: "NPM", name: node.name, version: node.version }),
  );
  const edges: TransitiveDepEdge[] = dedupeEdges(
    (payload.edges ?? [])
      .map((edge) => {
        const fromCanon = rawIndexToCanonical[edge.fromNode];
        const toCanon = rawIndexToCanonical[edge.toNode];
        if (fromCanon === undefined || toCanon === undefined) return null;
        const from = idByCanonical[fromCanon];
        const to = idByCanonical[toCanon];
        if (!from || !to || from === to) return null;
        return { from, to, requirement: edge.requirement };
      })
      .filter(Boolean) as TransitiveDepEdge[],
  );

  const data = { packageName, version, nodes, edges };
  bareGraphCache.set(cacheKey, { expires: Date.now() + GRAPH_CACHE_MS, data });
  return data;
}

async function enrichAdvisories(
  nodes: TransitiveDepNode[],
): Promise<TransitiveDepNode[]> {
  const targets = nodes
    .filter((n) => n.relation !== "SELF")
    .sort((a, b) => {
      const rank = (relation: TransitiveDepNode["relation"]) =>
        relation === "DIRECT" ? 0 : 1;
      return rank(a.relation) - rank(b.relation);
    })
    .slice(0, MAX_ADVISORY_LOOKUPS);
  const chunkSize = 8;
  const advisoryById = new Map<string, string[]>();

  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (node) => {
        const ids = await fetchVersionAdvisories({
          system: "NPM",
          name: node.name,
          version: node.version,
        });
        return { id: nodeId({ system: "NPM", name: node.name, version: node.version }), ids };
      }),
    );
    for (const { id, ids } of results) {
      advisoryById.set(id, ids);
    }
  }

  return nodes.map((node) => {
    const key = nodeId({ system: "NPM", name: node.name, version: node.version });
    const advisoryIds = advisoryById.get(key) ?? [];
    return {
      ...node,
      advisoryIds,
      advisoryCount: advisoryIds.length,
    };
  });
}

export async function fetchTransitiveDependencyGraph(
  packageName: string,
  version: string,
): Promise<TransitiveDependencyGraph> {
  const cacheKey = `${packageName.toLowerCase()}|${version}`;
  const cached = graphCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const bare = await loadBareDependencyGraph(packageName, version);
  const edges = bare.edges;
  const nodes = await enrichAdvisories(bare.nodes);

  const direct = nodes.filter((n) => n.relation === "DIRECT").length;
  const indirect = nodes.filter((n) => n.relation === "INDIRECT").length;
  const withAdvisories = nodes.filter((n) => n.advisoryCount > 0).length;

  const result: TransitiveDependencyGraph = {
    packageName,
    version,
    nodes,
    edges,
    stats: {
      total: nodes.length,
      direct,
      indirect,
      withAdvisories,
    },
    depsDevUrl: `https://deps.dev/npm/${encodePackagePath(packageName)}/${encodeURIComponent(version)}`,
  };

  graphCache.set(cacheKey, { expires: Date.now() + GRAPH_CACHE_MS, data: result });
  return result;
}

/** Direct npm dependencies that deps.dev lists with at least one advisory. */
export async function fetchNpmDirectAdvisories(
  packageName: string,
  version: string,
): Promise<Array<{ name: string; version: string; ids: string[] }>> {
  const bare = await loadBareDependencyGraph(packageName, version);
  const directs = bare.nodes
    .filter((node) => node.relation === "DIRECT")
    .slice(0, DIRECT_ADVISORY_CAP);
  const enriched = await enrichAdvisories(directs);
  return enriched
    .filter((node) => node.advisoryIds.length > 0)
    .map((node) => ({
      name: node.name,
      version: node.version,
      ids: node.advisoryIds.slice(0, 4),
    }));
}

export type NpmDepsDevVersionInsight = {
  packageName: string;
  version: string;
  advisoryIds: string[];
  isDefault: boolean;
  /**
   * Default version on deps.dev when it lists fewer advisories than this
   * version. Null when already on the clearer release or none is known.
   */
  saferVersion: string | null;
  depsDevUrl: string;
};

async function fetchNpmVersionRecord(
  packageName: string,
  version: string,
): Promise<{
  advisoryIds: string[];
  isDefault: boolean;
} | null> {
  const url = `${DEPS_DEV_API}/systems/npm/packages/${encodePackagePath(packageName)}/versions/${encodeURIComponent(version)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      advisoryKeys?: { id?: string }[];
      isDefault?: boolean;
    };
    const advisoryIds = (payload.advisoryKeys ?? [])
      .map((a) => a.id?.trim())
      .filter(Boolean) as string[];
    return { advisoryIds, isDefault: Boolean(payload.isDefault) };
  } catch {
    return null;
  }
}

async function fetchNpmDefaultVersion(
  packageName: string,
): Promise<string | null> {
  const url = `${DEPS_DEV_API}/systems/npm/packages/${encodePackagePath(packageName)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      versions?: Array<{
        versionKey?: { version?: string };
        isDefault?: boolean;
      }>;
    };
    const match = (payload.versions ?? []).find((entry) => entry.isDefault);
    const version = match?.versionKey?.version?.trim();
    return version || null;
  } catch {
    return null;
  }
}

/**
 * deps.dev advisories for this version, plus a clearer default release when
 * one lists fewer advisories.
 */
export async function fetchNpmDepsDevVersionInsight(
  packageName: string,
  version: string,
): Promise<NpmDepsDevVersionInsight | null> {
  const current = await fetchNpmVersionRecord(packageName, version);
  if (!current) return null;

  const depsDevUrl = `https://deps.dev/npm/${encodePackagePath(packageName)}/${encodeURIComponent(version)}`;
  let saferVersion: string | null = null;

  if (current.advisoryIds.length > 0 && !current.isDefault) {
    const defaultVersion = await fetchNpmDefaultVersion(packageName);
    if (defaultVersion && defaultVersion !== version) {
      const def = await fetchNpmVersionRecord(packageName, defaultVersion);
      if (def && def.advisoryIds.length < current.advisoryIds.length) {
        saferVersion = defaultVersion;
      }
    }
  }

  return {
    packageName,
    version,
    advisoryIds: current.advisoryIds.slice(0, 8),
    isDefault: current.isDefault,
    saferVersion,
    depsDevUrl,
  };
}
