import { headers } from "next/headers";
import { PackageAnalysisPage } from "@/components/analysis/PackageAnalysisPage";
import { recordOpenedPackage } from "@/lib/db/record-opened-package";
import {
  decodePackageParam,
  packagePageMetadata,
} from "@/lib/package-page-meta";

type NpmPackagePageProps = {
  params: Promise<{ name: string }>;
};

export async function generateMetadata({ params }: NpmPackagePageProps) {
  const { name } = await params;
  return packagePageMetadata("npm", name);
}

export default async function NpmPackagePage({ params }: NpmPackagePageProps) {
  const { name } = await params;
  const packageName = decodePackageParam(name);
  recordOpenedPackage("npm", packageName, await headers());

  return (
    <PackageAnalysisPage ecosystem="npm" nameFromPath={packageName} />
  );
}
