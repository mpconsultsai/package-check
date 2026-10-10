export type NugetDescription = {
  /** Prose summary, without the commonly-used-types list. */
  description: string;
  commonlyUsedTypes: string[];
  /** Trailing note, such as a minimum NuGet client version. */
  note: string | null;
};

const TYPE_NAME =
  /^(?:[A-Za-z_][\w]*\.)+[A-Za-z_][\w]*(?:<[A-Za-z_][\w]*(?:\s*,\s*[A-Za-z_][\w]*)*>)?$/;

/** .NET API reference for a commonly used type, including generic arity. */
export function dotnetApiReferenceUrl(typeName: string): string | null {
  const trimmed = typeName.trim();
  const generic = trimmed.match(/^(.+?)<([^<>]*)>$/);
  const name = generic?.[1] ?? trimmed;
  if (!/^(?:[A-Za-z_][\w]*\.)+[A-Za-z_][\w]*$/.test(name)) return null;
  const arity = generic
    ? generic[2].split(",").filter((part) => part.trim().length > 0).length
    : 0;
  const slug = name.toLowerCase() + (arity > 0 ? `-${arity}` : "");
  return `https://learn.microsoft.com/dotnet/api/${slug}`;
}

function collapseProse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Keep C# generic arguments such as List<T> and drop real HTML tags. */
function stripHtmlKeepGenerics(value: string): string {
  return value.replace(/<([^>]*)>/g, (full, inner: string, offset: number) => {
    const prev = offset > 0 ? value[offset - 1] : "";
    const attached = /[A-Za-z0-9_]/.test(prev);
    const typeArgs = /^[A-Za-z_][\w]*(?:\s*,\s*[A-Za-z_][\w]*)*$/.test(
      inner.trim(),
    );
    return attached && typeArgs ? full : " ";
  });
}

const TYPE_MARKER = /\n+\s*commonly used types:\s*\n+/i;
const PLATFORM_MARKER = /\n+\s*supported platforms?:\s*\n+/i;

function cleaned(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  return stripHtmlKeepGenerics(raw.replace(/\r\n/g, "\n")).trim();
}

/**
 * NuGet descriptions often end with a type list or a supported-platforms list.
 * When the catalog also has a short summary, that is the text to show.
 */
export function formatNugetDescription(
  raw: string | null | undefined,
  summary?: string | null,
): NugetDescription {
  const empty = { description: "", commonlyUsedTypes: [], note: null };
  const text = cleaned(raw);
  const short = collapseProse(cleaned(summary));
  if (!text && !short) return empty;
  if (!text) return { ...empty, description: short };

  const typeMarker = text.match(TYPE_MARKER);
  const platformMarker = text.match(PLATFORM_MARKER);
  const typeAt = typeMarker?.index ?? Number.POSITIVE_INFINITY;
  const platformAt = platformMarker?.index ?? Number.POSITIVE_INFINITY;
  const cutAt = Math.min(typeAt, platformAt);

  if (!Number.isFinite(cutAt)) {
    const prose = collapseProse(text);
    return {
      ...empty,
      description: short && short.length < prose.length ? short : prose,
    };
  }

  const prose = collapseProse(text.slice(0, cutAt));
  const description = short && short.length < prose.length ? short : prose;
  if (platformAt < typeAt) {
    return { ...empty, description };
  }

  const marker = typeMarker!;
  const rest = text.slice(cutAt + marker[0].length);
  const types: string[] = [];
  const notes: string[] = [];
  let listing = true;
  for (const line of rest.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (listing && TYPE_NAME.test(trimmed)) {
      types.push(trimmed);
      continue;
    }
    listing = false;
    notes.push(trimmed);
  }

  return {
    description,
    commonlyUsedTypes: types,
    note: notes.length > 0 ? collapseProse(notes.join(" ")) : null,
  };
}
