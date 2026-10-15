const USER_AGENT_MAX = 300;

type HeaderSource = {
  get(name: string): string | null;
};

export type ClientMetadata = Record<string, string | boolean>;

const AGENTS: ReadonlyArray<[RegExp, string]> = [
  [/cursor/i, "Cursor"],
  [/claude/i, "Claude"],
  [/chatgpt|openai/i, "ChatGPT"],
  [/vscode|visual studio code/i, "VS Code"],
  [/postman/i, "Postman"],
  [/insomnia/i, "Insomnia"],
  [/python-requests|^python\//i, "Python"],
  [/go-http-client/i, "Go"],
  [/^curl\//i, "curl"],
  [/^wget\//i, "wget"],
  [/^node\//i, "Node"],
];

function clip(value: string | null, max: number): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.slice(0, max);
}

function unquote(value: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.replace(/^"|"$/g, "");
}

function clientHintBrand(
  value: string | null,
): { name: string; version: string | null } | null {
  if (!value) return null;
  const brands: { name: string; version: string | null }[] = [];
  const pattern = /"([^"]+)"\s*;\s*v="([^"]*)"/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    brands.push({ name: match[1], version: match[2] || null });
  }
  return brands.find((brand) => !/chromium|not.?a.?brand/i.test(brand.name)) ?? null;
}

function versionAfter(userAgent: string, token: string): string | null {
  const match = userAgent.match(new RegExp(`${token}\\/(\\d+(?:\\.\\d+)*)`, "i"));
  return match?.[1] ?? null;
}

function parseUserAgent(userAgent: string | null): {
  agent: string | null;
  browser: string | null;
  browserVersion: string | null;
  platform: string | null;
  mobile: boolean | null;
} {
  if (!userAgent) {
    return {
      agent: null,
      browser: null,
      browserVersion: null,
      platform: null,
      mobile: null,
    };
  }

  const named = AGENTS.find(([pattern]) => pattern.test(userAgent));
  let browser: string | null = null;
  let browserVersion: string | null = null;
  if (/Edg\//i.test(userAgent)) {
    browser = "Edge";
    browserVersion = versionAfter(userAgent, "Edg");
  } else if (/OPR\/|Opera\//i.test(userAgent)) {
    browser = "Opera";
    browserVersion = versionAfter(userAgent, "OPR") ?? versionAfter(userAgent, "Opera");
  } else if (/Chrome\//i.test(userAgent) && !named) {
    browser = "Chrome";
    browserVersion = versionAfter(userAgent, "Chrome");
  } else if (/Firefox\//i.test(userAgent)) {
    browser = "Firefox";
    browserVersion = versionAfter(userAgent, "Firefox");
  } else if (/Safari\//i.test(userAgent) && /Version\//i.test(userAgent)) {
    browser = "Safari";
    browserVersion = versionAfter(userAgent, "Version");
  }

  const platform = /iPhone|iPad/i.test(userAgent)
    ? "iOS"
    : /Android/i.test(userAgent)
      ? "Android"
      : /Mac OS X/i.test(userAgent)
        ? "macOS"
        : /Windows/i.test(userAgent)
          ? "Windows"
          : /CrOS/i.test(userAgent)
            ? "ChromeOS"
            : /Linux/i.test(userAgent)
              ? "Linux"
              : null;
  const mobile = /iPhone|iPad|Android|Mobile/i.test(userAgent);

  return {
    agent: named?.[1] ?? browser,
    browser,
    browserVersion,
    platform,
    mobile,
  };
}

/** Browser and calling agent fields for search metadata. IP addresses are omitted. */
export function clientMetadata(headers: HeaderSource): ClientMetadata {
  const userAgent = clip(headers.get("user-agent"), USER_AGENT_MAX);
  const parsed = parseUserAgent(userAgent);
  const brand = clientHintBrand(headers.get("sec-ch-ua"));
  const platformHint = unquote(headers.get("sec-ch-ua-platform"));
  const mobileHint = headers.get("sec-ch-ua-mobile")?.trim();
  const fields: Record<string, string | boolean | null> = {
    userAgent,
    agent: parsed.agent,
    browser: brand?.name ?? parsed.browser,
    browserVersion: brand?.version ?? parsed.browserVersion,
    platform: platformHint ?? parsed.platform,
    mobile: mobileHint === "?1" ? true : mobileHint === "?0" ? false : parsed.mobile,
  };
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string | boolean] => entry[1] !== null),
  );
}
