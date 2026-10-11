import { PackageAnalysisPage } from "@/components/analysis/PackageAnalysisPage";
import { recordOpenedPackage } from "@/lib/db/record-opened-package";
import {
  decodePackageParam,
  packagePageMetadata,
} from "@/lib/package-page-meta";

type NugetPackagePageProps = {
  params: Promise<{ name: string }>;
};

export async function generateMetadata({ params }: NugetPackagePageProps) {
  const { name } = await params;
  return packagePageMetadata("nuget", name);
}

export default async function NugetPackagePage({
  params,
}: NugetPackagePageProps) {
  const { name } = await params;
  const packageName = decodePackageParam(name);
  recordOpenedPackage("nuget", packageName);

  return (
    <PackageAnalysisPage ecosystem="nuget" nameFromPath={packageName} />
  );
}
