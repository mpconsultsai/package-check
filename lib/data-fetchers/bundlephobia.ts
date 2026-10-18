import axios from "axios";
import {
  topBundleModules,
  type BundleModuleShare,
} from "@/lib/packages/npm-package-facts";

const BUNDLEPHOBIA_SIZE_URL = "https://bundlephobia.com/api/size";

const BUNDLEPHOBIA_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (compatible; pkglens/1.0; +https://github.com)",
  Origin: "https://bundlephobia.com",
  Referer: "https://bundlephobia.com/",
};

export interface BundleSizeInfo {
  size: number;
  gzip: number;
  version?: string;
  /** Largest constituent modules, when Bundlephobia reports them. */
  composition?: BundleModuleShare[];
}

/**
 * Fetch browser bundle size (minified + gzip) from Bundlephobia.
 * Returns null when the package cannot be bundled or the API is unavailable.
 */
export async function fetchBundleSize(
  packageName: string,
  version?: string,
): Promise<BundleSizeInfo | null> {
  const pkg =
    version && version !== "Unknown"
      ? `${packageName}@${version}`
      : packageName;

  try {
    const response = await axios.get(BUNDLEPHOBIA_SIZE_URL, {
      params: { package: pkg },
      timeout: 20_000,
      headers: BUNDLEPHOBIA_HEADERS,
      validateStatus: (status) => status === 200,
    });

    const data = response.data;
    const size = Number(data?.size);
    const gzip = Number(data?.gzip);

    if (!Number.isFinite(size) || !Number.isFinite(gzip)) {
      return null;
    }

    const composition = topBundleModules(data?.dependencySizes, size);

    return {
      size,
      gzip,
      version: typeof data?.version === "string" ? data.version : version,
      ...(composition.length > 0 ? { composition } : {}),
    };
  } catch (error: unknown) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "unknown error";
    console.warn(`Bundlephobia unavailable for ${pkg}: ${message}`);
    return null;
  }
}
