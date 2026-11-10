import { PackageAnalysisPage } from "@/components/analysis/PackageAnalysisPage";
import {
  decodePackageParam,
  packagePageMetadata,
} from "@/lib/packages/package-page-meta";

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

  return (
    <PackageAnalysisPage ecosystem="pypi" nameFromPath={packageName} />
  );
}
