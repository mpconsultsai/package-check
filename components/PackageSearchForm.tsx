"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  extractPackageName,
  validatePackageNameForEcosystem,
} from "@/lib/packages/validation";
import {
  parsePackageRoute,
  registryLabel,
  type PackageEcosystem,
} from "@/lib/packages/package-routes";
import {
  getEcosystemPreference,
  setEcosystemPreference,
} from "@/lib/prefs/ecosystem-pref";
import { featuresForEcosystem } from "@/lib/packages/ecosystem-features";
import { smoothNavigate } from "@/lib/prefs/smooth-navigate";
import { useAiAnalysisPref } from "@/lib/prefs/use-ai-analysis-pref";
import {
  useThemePreference,
  useThemePrefReady,
  useSystemDark,
} from "@/lib/prefs/use-theme-pref";
import { resolveTheme, setThemePreference } from "@/lib/prefs/theme-pref";
import {
  type PackageManagerPreference,
} from "@/lib/prefs/package-manager-pref";
import { usePackageManagerPref } from "@/lib/prefs/use-package-manager-pref";
import { WatchlistSection } from "@/components/Watchlist";
import { PasteListPanel } from "@/components/PasteList";
import { useWatchlist } from "@/lib/prefs/use-watchlist";
import { useWatchlistRefresh } from "@/lib/prefs/use-watchlist-refresh";
import { summarizeWatchlistAlerts } from "@/lib/prefs/watchlist-store";
import { apiPaths } from "@/lib/api/paths";
import { EXAMPLE_PACKAGES } from "@/lib/site/example-packages";
import {
  ClearIcon,
  SearchIcon,
} from "@/components/icons";

const THEME_OPTIONS: { value: "light" | "dark"; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const REGISTRY_TABS = [
  { id: "npm" as const, label: "npm" },
  { id: "pypi" as const, label: "PyPI" },
  { id: "nuget" as const, label: "NuGet" },
] as const;

const INSTALL_PREFIX: Record<PackageEcosystem, string> = {
  npm: "npm i",
  pypi: "pip install",
  nuget: "dotnet add package",
};

const PACKAGE_MANAGER_OPTIONS: {
  value: PackageManagerPreference;
  label: string;
}[] = [
  { value: "auto", label: "Auto" },
  { value: "npm", label: "npm" },
  { value: "pnpm", label: "pnpm" },
  { value: "yarn", label: "yarn" },
  { value: "bun", label: "bun" },
];

export interface PackageSearchSuggestion {
  name: string;
  description: string;
  version: string;
}

interface PackageSearchFormProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (packageName: string, ecosystem: PackageEcosystem) => void;
  initialEcosystem?: PackageEcosystem;
  onEcosystemChange?: (ecosystem: PackageEcosystem) => void;
  loading?: boolean;
  disabled?: boolean;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

type UtilityPanel = "watchlist" | "paste" | "settings" | null;

export function PackageSearchForm({
  value,
  onChange,
  onSearch,
  initialEcosystem = "npm",
  onEcosystemChange,
  loading = false,
  disabled = false,
}: PackageSearchFormProps) {
  const [ecosystem, setEcosystemState] =
    useState<PackageEcosystem>(initialEcosystem);
  const listboxId = useId();
  const registryId = useId();
  const registryPanelId = `${registryId}-panel`;
  const registryTabId = (id: PackageEcosystem) => `${registryId}-${id}`;
  const router = useRouter();
  const pathname = usePathname();
  const cardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const watchlistPanelRef = useRef<HTMLDivElement>(null);
  const pastePanelRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const allowDropdownRef = useRef(false);
  const lastUtilityTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null);
  const [suggestions, setSuggestions] = useState<PackageSearchSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const dismissDropdown = useCallback(() => {
    allowDropdownRef.current = false;
    abortRef.current?.abort();
    setIsOpen(false);
    setHighlightIndex(-1);
    setSuggestions([]);
    setSearchCompleted(false);
    setIsSearching(false);
  }, []);

  const closeUtilityPanel = useCallback((restoreFocus = false) => {
    setUtilityPanel(null);
    if (restoreFocus) {
      queueMicrotask(() => lastUtilityTriggerRef.current?.focus());
    }
  }, []);

  const toggleUtilityPanel = useCallback(
    (
      panel: Exclude<UtilityPanel, null>,
      trigger: HTMLButtonElement | null,
    ) => {
      lastUtilityTriggerRef.current = trigger;
      setUtilityPanel((current) => (current === panel ? null : panel));
      dismissDropdown();
    },
    [dismissDropdown],
  );

  const setEcosystem = useCallback(
    (next: PackageEcosystem) => {
      if (next === ecosystem) return;
      setEcosystemState(next);
      setEcosystemPreference(next);
      onEcosystemChange?.(next);
      dismissDropdown();
      closeUtilityPanel();
      onChange("");
      if (parsePackageRoute(pathname)) {
        smoothNavigate(() => router.push("/"));
      }
    },
    [
      ecosystem,
      dismissDropdown,
      closeUtilityPanel,
      onChange,
      onEcosystemChange,
      pathname,
      router,
    ],
  );

  const onRegistryTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    if (tabs.length === 0) return;
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    const index =
      current >= 0
        ? current
        : REGISTRY_TABS.findIndex((tab) => tab.id === ecosystem);
    let nextIndex = index;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    const nextId = nextTab?.dataset.ecosystem;
    if (
      nextId === "npm" ||
      nextId === "pypi" ||
      nextId === "nuget"
    ) {
      if (nextId !== ecosystem) setEcosystem(nextId);
    }
    nextTab?.focus();
  };

  useEffect(() => {
    const route = parsePackageRoute(pathname);
    if (route?.ecosystem) {
      setEcosystemState(route.ecosystem);
      return;
    }
    if (pathname === "/") {
      setEcosystemState(getEcosystemPreference());
      return;
    }
    setEcosystemState(initialEcosystem);
  }, [pathname, initialEcosystem]);

  const runSearch = useCallback(
    (name: string) => {
      const trimmed = extractPackageName(name);
      if (!trimmed) return;
      const validation = validatePackageNameForEcosystem(trimmed, ecosystem);
      if (!validation.valid) return;
      dismissDropdown();
      closeUtilityPanel();
      inputRef.current?.blur();
      onChange(trimmed);
      onSearch(trimmed, ecosystem);
    },
    [onChange, onSearch, dismissDropdown, closeUtilityPanel, ecosystem],
  );

  const handleClear = useCallback(() => {
    allowDropdownRef.current = true;
    dismissDropdown();
    onChange("");
    if (pathname !== "/") {
      smoothNavigate(() => router.push("/"));
      return;
    }
    inputRef.current?.focus();
  }, [onChange, dismissDropdown, pathname, router]);

  useEffect(() => {
    if (loading || !allowDropdownRef.current || utilityPanel) return;

    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      dismissDropdown();
      return;
    }

    setSearchCompleted(false);

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsSearching(true);
      try {
        const res = await fetch(
          `${apiPaths.packages.search}?q=${encodeURIComponent(query)}&limit=8&ecosystem=${ecosystem}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        if (controller.signal.aborted || !allowDropdownRef.current) return;

        const packages: PackageSearchSuggestion[] = data.packages ?? [];
        setSuggestions(packages);
        setIsOpen(true);
        setHighlightIndex(packages.length > 0 ? 0 : -1);
        setSearchCompleted(true);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!allowDropdownRef.current) return;
        setSuggestions([]);
        setIsOpen(true);
        setSearchCompleted(true);
        setHighlightIndex(-1);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [value, dismissDropdown, loading, utilityPanel, ecosystem]);

  useEffect(() => {
    if (loading) dismissDropdown();
  }, [loading, dismissDropdown]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        dismissDropdown();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [dismissDropdown]);

  useEffect(() => {
    if (!utilityPanel) return;
    const mq = window.matchMedia("(max-width: 639px)");
    const closeOnMobile = () => {
      if (mq.matches) closeUtilityPanel(false);
    };
    closeOnMobile();
    mq.addEventListener("change", closeOnMobile);
    return () => mq.removeEventListener("change", closeOnMobile);
  }, [utilityPanel, closeUtilityPanel]);

  useEffect(() => {
    if (!utilityPanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeUtilityPanel(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [utilityPanel, closeUtilityPanel]);

  useEffect(() => {
    if (utilityPanel === "watchlist") {
      watchlistPanelRef.current?.focus();
    } else if (utilityPanel === "paste") {
      pastePanelRef.current?.focus();
    } else if (utilityPanel === "settings") {
      settingsPanelRef.current?.focus();
    }
  }, [utilityPanel]);

  const showResultsPanel =
    !utilityPanel &&
    !loading &&
    isOpen &&
    value.trim().length >= MIN_QUERY_LENGTH &&
    !isSearching;
  const showSuggestions = showResultsPanel && suggestions.length > 0;
  const showNoMatches =
    showResultsPanel && searchCompleted && suggestions.length === 0;
  const popupOpen = showSuggestions || showNoMatches;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isOpen && highlightIndex >= 0 && suggestions[highlightIndex]) {
      runSearch(suggestions[highlightIndex].name);
      return;
    }
    runSearch(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && utilityPanel) {
      e.preventDefault();
      closeUtilityPanel(true);
      return;
    }

    if (e.key === "Escape" && popupOpen) {
      e.preventDefault();
      dismissDropdown();
      inputRef.current?.focus();
      return;
    }

    if (!showSuggestions) return;

    const lastIndex = suggestions.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => (i >= lastIndex ? 0 : i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => (i <= 0 ? lastIndex : i - 1));
        break;
      case "Home":
        e.preventDefault();
        setHighlightIndex(0);
        break;
      case "End":
        e.preventDefault();
        setHighlightIndex(lastIndex);
        break;
      case "Enter":
        if (highlightIndex >= 0 && suggestions[highlightIndex]) {
          e.preventDefault();
          runSearch(suggestions[highlightIndex].name);
        }
        break;
      case "Tab":
        dismissDropdown();
        break;
    }
  };

  const activeOptionId =
    showSuggestions && highlightIndex >= 0
      ? `${listboxId}-option-${highlightIndex}`
      : undefined;

  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  const showClear = value.length > 0 && !disabled && !loading;
  const isHome = pathname === "/";
  const pasteFeatures = featuresForEcosystem(ecosystem);
  const showPasteList = pasteFeatures.pasteList;
  const pasteLabel =
    ecosystem === "pypi"
      ? "Analyse dependency file"
      : ecosystem === "nuget"
        ? "Analyse project file"
        : "Analyse package.json";
  const { enabled: aiEnabled, setEnabled: setAiEnabled, ready: aiPrefReady } =
    useAiAnalysisPref();
  const themePreference = useThemePreference();
  const systemDark = useSystemDark();
  const themePrefReady = useThemePrefReady();
  const resolvedTheme = resolveTheme(themePreference, systemDark);
  const {
    preference: packageManager,
    setPreference: setPackageManager,
    ready: packageManagerReady,
  } = usePackageManagerPref();
  const watchlist = useWatchlist().filter(
    (entry) => (entry.ecosystem ?? "npm") === ecosystem,
  );
  const watchCount = watchlist.length;
  const alertSummary = summarizeWatchlistAlerts(watchlist);
  const { checking: watchlistChecking } = useWatchlistRefresh(isHome);

  useEffect(() => {
    if (!showPasteList && utilityPanel === "paste") {
      closeUtilityPanel();
    }
  }, [showPasteList, utilityPanel, closeUtilityPanel]);

  const watchlistAction = utilityPanel === "watchlist" ? "Hide" : "Show";
  const watchedPackages = `${watchCount} ${watchCount === 1 ? "package" : "packages"}`;
  const watchlistLabel =
    watchCount === 0
      ? `${watchlistAction} watchlist`
      : alertSummary.total > 0
        ? `${watchlistAction} watchlist (${watchedPackages}, ${alertSummary.total} with updates)`
        : `${watchlistAction} watchlist (${watchedPackages})`;

  const utilityButtonClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 border-b-2 pb-1 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
      active
        ? "border-ink text-ink"
        : "border-transparent text-gray-500 hover:text-ink dark:text-gray-400"
    }`;

  return (
    <div ref={cardRef} className="mb-6 sm:mb-8">
      <form
        onSubmit={handleSubmit}
        role="search"
        aria-label="Find a package"
        className="min-w-0 space-y-3"
      >
          <div className="flex items-end justify-between gap-2">
            <div
              role="tablist"
              aria-label="Package registry"
              aria-orientation="horizontal"
              onKeyDown={onRegistryTabKeyDown}
              className="flex min-w-0 flex-1 gap-5 font-mono text-sm"
            >
              {REGISTRY_TABS.map((option) => {
                const selected = ecosystem === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    id={registryTabId(option.id)}
                    data-ecosystem={option.id}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={registryPanelId}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setEcosystem(option.id)}
                    className={`border-b-2 pb-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${
                      selected
                        ? "border-signal font-semibold text-ink"
                        : "border-transparent text-gray-500 hover:text-ink dark:text-gray-400"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div
              role="toolbar"
              aria-label="Search utilities"
              className="hidden shrink-0 items-center gap-5 sm:flex"
            >
              <button
                type="button"
                title={watchlistLabel}
                aria-label={watchlistLabel}
                aria-expanded={utilityPanel === "watchlist"}
                aria-controls="shell-panel-watchlist"
                aria-haspopup="true"
                onClick={(e) =>
                  toggleUtilityPanel("watchlist", e.currentTarget)
                }
                className={utilityButtonClass(utilityPanel === "watchlist")}
              >
                <span>
                  Watchlist
                  {watchCount > 0 && (
                    <span className="tabular-nums"> ({watchCount})</span>
                  )}
                </span>
                {alertSummary.total > 0 && (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      alertSummary.tone === "vulns"
                        ? "bg-red-600"
                        : alertSummary.tone === "version"
                          ? "bg-emerald-600"
                          : "bg-orange-600"
                    }`}
                    aria-hidden="true"
                  />
                )}
              </button>
              {showPasteList && (
                <button
                  type="button"
                  title={
                    utilityPanel === "paste"
                      ? `Close ${pasteLabel}`
                      : pasteLabel
                  }
                  aria-label={`Review package file: ${pasteLabel}`}
                  aria-expanded={utilityPanel === "paste"}
                  aria-controls="shell-panel-paste"
                  aria-haspopup="true"
                  onClick={(e) =>
                    toggleUtilityPanel("paste", e.currentTarget)
                  }
                  className={utilityButtonClass(utilityPanel === "paste")}
                >
                  Review package file
                </button>
              )}
              <button
                type="button"
                title={
                  utilityPanel === "settings"
                    ? "Hide settings"
                    : "Show settings"
                }
                aria-label={
                  utilityPanel === "settings"
                    ? "Hide settings"
                    : "Show settings"
                }
                aria-expanded={utilityPanel === "settings"}
                aria-controls="shell-panel-settings"
                aria-haspopup="true"
                onClick={(e) =>
                  toggleUtilityPanel("settings", e.currentTarget)
                }
                className={utilityButtonClass(utilityPanel === "settings")}
              >
                Settings
              </button>
            </div>
          </div>
          <div
            id={registryPanelId}
            role="tabpanel"
            aria-labelledby={registryTabId(ecosystem)}
            className="space-y-3"
          >
          <div ref={containerRef} className="relative">
            <label id="package-name-label" htmlFor="packageName" className="sr-only">
              Package name
            </label>
            <div className="relative flex items-stretch border border-gray-400 bg-white transition-colors focus-within:border-ink dark:border-gray-600 dark:bg-gray-800 dark:focus-within:border-gray-300">
              <span
                className="pointer-events-none flex select-none items-center pl-3 pr-2 font-mono text-base text-gray-500 sm:pl-4 sm:text-lg dark:text-gray-400"
                aria-hidden="true"
              >
                <span className="sm:hidden">
                  <SearchIcon />
                </span>
                <span className="hidden sm:inline">
                  <span className="text-signal">$</span> {INSTALL_PREFIX[ecosystem]}
                </span>
              </span>
              <input
                ref={inputRef}
                type="search"
                id="packageName"
                name="packageName"
                aria-labelledby="package-name-label"
                value={value}
                onChange={(e) => {
                  allowDropdownRef.current = true;
                  closeUtilityPanel();
                  onChange(e.target.value);
                }}
                onFocus={() => {
                  if (utilityPanel) closeUtilityPanel();
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  ecosystem === "pypi"
                    ? "project name"
                    : "package name"
                }
                className={`min-w-0 flex-1 bg-transparent py-3 font-mono text-base text-ink outline-none placeholder:text-gray-500 disabled:opacity-60 sm:py-3.5 sm:text-lg dark:placeholder:text-gray-400 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden ${
                  showClear ? "pr-10" : "pr-3"
                }`}
                disabled={disabled || loading}
                role="combobox"
                aria-expanded={popupOpen}
                aria-controls={
                  showSuggestions
                    ? listboxId
                    : showNoMatches
                      ? `${listboxId}-empty`
                      : undefined
                }
                aria-activedescendant={activeOptionId}
                aria-haspopup="listbox"
                aria-autocomplete="list"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                inputMode="search"
              />
              {showClear && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="self-center mr-1 rounded-sm p-1.5 text-gray-500 transition-colors hover:text-ink dark:text-gray-400"
                  aria-label="Clear search"
                >
                  <ClearIcon />
                </button>
              )}
              <button
                type="submit"
                className="sr-only"
                disabled={disabled || loading || !value.trim()}
              >
                {ecosystem === "pypi"
                  ? "Analyse PyPI package"
                  : ecosystem === "nuget"
                    ? "Analyse NuGet package"
                    : "Analyse npm package"}
              </button>
            </div>
            {!loading &&
              !utilityPanel &&
              isSearching &&
              value.trim().length >= MIN_QUERY_LENGTH && (
                <p
                  className="mt-2.5 text-xs text-gray-500 dark:text-gray-400"
                  role="status"
                  aria-live="polite"
                >
                  {ecosystem === "pypi"
                    ? "Searching PyPI…"
                    : ecosystem === "nuget"
                      ? "Searching NuGet…"
                      : "Searching npm…"}
                </p>
              )}
            {showNoMatches && (
              <div
                id={`${listboxId}-empty`}
                role="status"
                className="absolute z-20 -mt-px w-full border border-ink bg-white px-4 py-3 shadow-xl dark:border-gray-300 dark:bg-gray-800"
              >
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No matches found
                </p>
              </div>
            )}
            {showSuggestions && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label="Package suggestions"
                className="absolute z-20 -mt-px w-full max-h-80 divide-y divide-rule overflow-y-auto border border-ink bg-white shadow-xl dark:border-gray-300 dark:bg-gray-800"
              >
                {suggestions.map((pkg, index) => {
                  const selected = index === highlightIndex;
                  return (
                    <li
                      key={pkg.name}
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => runSearch(pkg.name)}
                      className={`cursor-pointer px-4 py-2.5 text-left ${
                        selected
                          ? "bg-gray-50 shadow-[inset_3px_0_0_var(--signal)] dark:bg-gray-900/60"
                          : ""
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-mono text-[0.9375rem] font-medium text-ink">
                          {pkg.name}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-gray-500 tabular-nums dark:text-gray-400">
                          {pkg.version}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-gray-600 dark:text-gray-400">
                        {pkg.description}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
            <span aria-hidden="true">Or try</span>
            <ul
              aria-label={
                ecosystem === "pypi"
                  ? "Example PyPI projects"
                  : ecosystem === "nuget"
                    ? "Example NuGet packages"
                    : "Example npm packages"
              }
              className="flex flex-wrap items-baseline gap-x-1"
            >
              {EXAMPLE_PACKAGES[ecosystem].map((name, index, all) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => runSearch(name)}
                    disabled={disabled || loading}
                    className="link font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-60"
                  >
                    {name}
                  </button>
                  {index < all.length - 2 ? (
                    <span aria-hidden="true">,</span>
                  ) : index === all.length - 2 ? (
                    <span aria-hidden="true"> or</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          </div>
      </form>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
          {utilityPanel === "watchlist"
            ? watchCount > 0
              ? `Watchlist opened, ${watchCount} ${registryLabel(ecosystem)} packages`
              : "Watchlist opened, no packages yet"
            : utilityPanel === "paste"
              ? `${pasteLabel} opened`
              : utilityPanel === "settings"
                ? "Settings opened"
                : ""}
      </div>

      {utilityPanel === "watchlist" && (
        <div
          id="shell-panel-watchlist"
          ref={watchlistPanelRef}
          role="region"
          aria-labelledby="shell-watchlist-heading"
          tabIndex={-1}
          className="mt-4 border border-rule bg-white p-4 sm:p-5 dark:bg-gray-800 max-h-80 overflow-y-auto outline-none"
        >
          <h2 id="shell-watchlist-heading" className="sr-only">
            Watchlist
          </h2>
          <WatchlistSection
            embedded
            ecosystem={ecosystem}
            checking={watchlistChecking}
          />
        </div>
      )}

      {showPasteList && utilityPanel === "paste" && (
        <div
          id="shell-panel-paste"
          ref={pastePanelRef}
          role="region"
          aria-labelledby="shell-paste-heading"
          tabIndex={-1}
          className="mt-4 border border-rule bg-white p-4 sm:p-5 dark:bg-gray-800 max-h-[32rem] overflow-y-auto outline-none"
        >
          <h2 id="shell-paste-heading" className="sr-only">
            {pasteLabel}
          </h2>
          <PasteListPanel key={ecosystem} ecosystem={ecosystem} />
        </div>
      )}

      {utilityPanel === "settings" && (
        <div
          id="shell-panel-settings"
          ref={settingsPanelRef}
          role="region"
          aria-labelledby="shell-settings-heading"
          tabIndex={-1}
          className="mt-4 border border-rule bg-white px-4 sm:px-5 dark:bg-gray-800 outline-none"
        >
          <h2 id="shell-settings-heading" className="sr-only">
            Settings
          </h2>
          <div className="divide-y divide-rule">
            <div className="flex items-center justify-between gap-4 py-3.5">
              <div>
                <p
                  id="ai-analysis-toggle-label"
                  className="text-sm font-semibold text-ink"
                >
                  AI second opinion
                </p>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  Adds a model-written summary under the figures.
                </p>
              </div>
              {aiPrefReady ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={aiEnabled}
                  aria-labelledby="ai-analysis-toggle-label"
                  onClick={() => setAiEnabled(!aiEnabled)}
                  className="inline-flex shrink-0 border border-ink font-mono text-xs uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                >
                  <span
                    className={`px-2.5 py-1.5 ${aiEnabled ? "bg-ink text-paper" : "text-gray-600 dark:text-gray-400"}`}
                    aria-hidden="true"
                  >
                    On
                  </span>
                  <span
                    className={`px-2.5 py-1.5 ${aiEnabled ? "text-gray-600 dark:text-gray-400" : "bg-ink text-paper"}`}
                    aria-hidden="true"
                  >
                    Off
                  </span>
                </button>
              ) : (
                <span
                  className="inline-block h-7 w-20 shrink-0 bg-gray-200 dark:bg-gray-700"
                  aria-hidden="true"
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-4 py-3.5">
              <p
                id="theme-preference-label"
                className="text-sm font-semibold text-ink"
              >
                Theme
              </p>
              {themePrefReady ? (
                <div
                  role="radiogroup"
                  aria-labelledby="theme-preference-label"
                  className="inline-flex shrink-0 border border-ink font-mono text-xs uppercase tracking-[0.08em]"
                >
                  {THEME_OPTIONS.map(({ value, label }) => {
                    const selected = resolvedTheme === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setThemePreference(value)}
                        className={`px-2.5 py-1.5 uppercase transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
                          selected
                            ? "bg-ink text-paper"
                            : "text-gray-600 hover:text-ink dark:text-gray-400"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span
                  className="inline-block h-7 w-28 shrink-0 bg-gray-200 dark:bg-gray-700"
                  aria-hidden="true"
                />
              )}
            </div>

            {pasteFeatures.npmPackageManagerSettings ? (
              <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <p
                    id="package-manager-preference-label"
                    className="text-sm font-semibold text-ink"
                  >
                    npm client
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                    Used for the install commands in upgrade advice.
                  </p>
                </div>
                {packageManagerReady ? (
                  <select
                    id="package-manager-preference"
                    aria-labelledby="package-manager-preference-label"
                    value={packageManager}
                    onChange={(e) =>
                      setPackageManager(e.target.value as PackageManagerPreference)
                    }
                    className="w-full shrink-0 border border-gray-400 bg-transparent px-2.5 py-1.5 font-mono text-sm text-ink focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:w-40 dark:border-gray-500"
                  >
                    {PACKAGE_MANAGER_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className="inline-block h-8 w-40 shrink-0 bg-gray-200 dark:bg-gray-700"
                    aria-hidden="true"
                  />
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
