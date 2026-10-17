"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { HeaderGithubProvider } from "@/components/header-github";
import { WhatWeCheck } from "@/components/WhatWeCheck";
import { ShellEcosystemContext } from "@/components/shell-ecosystem";
import { PageHeader } from "@/components/PageHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PackageSearchForm } from "@/components/PackageSearchForm";
import { smoothNavigate } from "@/lib/smooth-navigate";
import {
  packagePagePath,
  parsePackageRoute,
  type PackageEcosystem,
} from "@/lib/package-routes";
import {
  getEcosystemPreference,
  setEcosystemPreference,
} from "@/lib/ecosystem-pref";

const SearchLoadingContext = createContext<Dispatch<
  SetStateAction<boolean>
> | null>(null);

export function useShellSearchLoading(loading: boolean) {
  const setLoading = useContext(SearchLoadingContext);
  useLayoutEffect(() => {
    if (!setLoading) return;
    setLoading(loading);
    return () => setLoading(false);
  }, [loading, setLoading]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const route = parsePackageRoute(pathname);
  const pathPackage = route?.name ?? "";
  const pathEcosystem: PackageEcosystem = route?.ecosystem ?? "npm";
  const isHome = pathname === "/";
  const [query, setQuery] = useState(pathPackage);
  const [searchLoading, setSearchLoading] = useState(false);
  const [toolbarEcosystem, setToolbarEcosystem] =
    useState<PackageEcosystem>(pathEcosystem);

  useEffect(() => {
    setQuery(pathPackage);
    if (route?.ecosystem) {
      setEcosystemPreference(route.ecosystem);
      setToolbarEcosystem(route.ecosystem);
    } else if (pathname === "/") {
      setToolbarEcosystem(getEcosystemPreference());
    }
  }, [pathPackage, route?.ecosystem, pathname]);

  const routeEcosystem = route?.ecosystem;
  const hideRoutePanel = Boolean(
    routeEcosystem && routeEcosystem !== toolbarEcosystem,
  );
  const showPackageDivider = !isHome && !hideRoutePanel;

  useLayoutEffect(() => {
    if (route?.name && !hideRoutePanel) {
      setSearchLoading(true);
    }
  }, [pathname, route?.name, hideRoutePanel]);

  const handleEcosystemChange = (next: PackageEcosystem) => {
    setToolbarEcosystem(next);
    setSearchLoading(false);
  };

  return (
    <SearchLoadingContext.Provider value={setSearchLoading}>
      <ShellEcosystemContext.Provider value={toolbarEcosystem}>
      <HeaderGithubProvider>
      <main className="min-h-screen bg-paper text-ink">
        <div className="mx-auto px-4 pt-4 pb-6 sm:px-6 sm:pt-6 sm:pb-10">
          <div className="mx-auto max-w-5xl">
            <div className="site-chrome-header">
              <PageHeader showHomeLink={!isHome} />
            </div>
            <div className="site-chrome-search relative z-30">
              <PackageSearchForm
                value={query}
                onChange={setQuery}
                initialEcosystem={pathEcosystem}
                onEcosystemChange={handleEcosystemChange}
                onSearch={(name, ecosystem) => {
                  setSearchLoading(true);
                  smoothNavigate(() =>
                    router.push(packagePagePath(ecosystem, name)),
                  );
                }}
                loading={searchLoading}
              />
            </div>
            {showPackageDivider && (
              <div
                className="mt-6 mb-5 sm:mt-8 sm:mb-6 border-t border-rule"
                role="separator"
                aria-hidden="true"
              />
            )}
            <div
              key={isHome ? pathname : `${pathname}:${toolbarEcosystem}`}
              className="route-panel relative z-0"
            >
              {hideRoutePanel && route ? <WhatWeCheck /> : children}
            </div>
            <SiteFooter />
          </div>
        </div>
      </main>
      </HeaderGithubProvider>
      </ShellEcosystemContext.Provider>
    </SearchLoadingContext.Provider>
  );
}
