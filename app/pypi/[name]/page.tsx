import { PackageAnalysisPage } from "@/components/analysis/PackageAnalysisPage";
import { recordOpenedPackage } from "@/lib/db/record-opened-package";
import {
  decodePackageParam,
  packagePageMetadata,
} from "@/lib/package-page-meta";

type PypiPackagePageProps = {
  params: Promise<{ name: string }>;
};

export async function generateMetadata({ params }: PypiPackagePageProps) {
  const { name } = await params;
  return packagePageMetadata("pypi", name);
}

export default async function PypiPackagePage({
  params,
}: PypiPackagePageProps) {
  const { name } = await params;
  const packageName = decodePackageParam(name);
  recordOpenedPackage("pypi", packageName);

  return (
    <PackageAnalysisPage ecosystem="pypi" nameFromPath={packageName} />
  );
}
