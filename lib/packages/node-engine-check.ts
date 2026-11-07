import semver from "semver";

export type EngineRangeChange = {
  name: string;
  kind: string;
  range?: string;
  from?: string;
  to?: string;
};

/**
 * Whether `nodeVersion` (e.g. 20.11.1) satisfies an engines.node range.
 * Null when the inputs cannot be evaluated.
 */
export function nodeSatisfiesEngine(
  nodeVersion: string,
  range: string,
): boolean | null {
  const clean =
    semver.valid(nodeVersion) ??
    semver.coerce(nodeVersion)?.version ??
    null;
  const trimmed = range.trim();
  if (!clean || !trimmed) return null;
  try {
    return semver.satisfies(clean, trimmed, { includePrerelease: true });
  } catch {
    return null;
  }
}

/** Target engines.node range from a from→to engines diff. */
export function targetNodeEngineRange(
  engines: EngineRangeChange[] | null | undefined,
): string | null {
  const node = (engines ?? []).find(
    (entry) => entry.name.toLowerCase() === "node",
  );
  if (!node) return null;
  if (node.kind === "removed") return null;
  const range = (node.kind === "changed" ? node.to : node.range || node.to)?.trim();
  return range || null;
}

export type NodeEngineCheck = {
  required: string | null;
  satisfies: boolean | null;
  message: string | null;
};

export function checkNodeAgainstTargetEngines(options: {
  nodeVersion: string | null | undefined;
  engines: EngineRangeChange[] | null | undefined;
}): NodeEngineCheck {
  const required = targetNodeEngineRange(options.engines);
  const runtime = options.nodeVersion?.trim() ?? "";
  if (!required) {
    return { required: null, satisfies: null, message: null };
  }
  if (!runtime) {
    return {
      required,
      satisfies: null,
      message: `Target requires Node ${required}. Enter the runtime Node version to check compatibility.`,
    };
  }
  const satisfies = nodeSatisfiesEngine(runtime, required);
  if (satisfies === true) {
    return {
      required,
      satisfies: true,
      message: `Node ${runtime} satisfies the target engines.node ${required}.`,
    };
  }
  if (satisfies === false) {
    return {
      required,
      satisfies: false,
      message: `Node ${runtime} does not satisfy engines.node ${required} on the target.`,
    };
  }
  return {
    required,
    satisfies: null,
    message: `Could not evaluate Node ${runtime} against engines.node ${required}.`,
  };
}
