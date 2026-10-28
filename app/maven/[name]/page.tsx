import { headers } from "next/headers";
import { PackageAnalysisPage } from "@/components/analysis/PackageAnalysisPage";
import { recordOpenedPackage } from "@/lib/db/record-opened-package";
import {
  decodePackageParam,
  packagePageMetadata,
} from "@/lib/packages/package-page-meta";

type MavenPackagePageProps = {
  params: Promise<{ name: string }>;
};

export async function generateMetadata({ params }: MavenPackagePageProps) {
  const { name } = await params;
  return packagePageMetadata("maven", name);
}

export default async function MavenPackagePage({
  params,
}: MavenPackagePageProps) {
  const { name } = await params;
  const packageName = decodePackageParam(name);
  recordOpenedPackage("maven", packageName, await headers());

  return (
    <PackageAnalysisPage ecosystem="maven" nameFromPath={packageName} />
  );
}
