import { PackageAnalysisPage } from "@/components/analysis/PackageAnalysisPage";
import {
  decodePackageParam,
  packagePageMetadata,
} from "@/lib/packages/package-page-meta";

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

  return (
    <PackageAnalysisPage ecosystem="npm" nameFromPath={packageName} />
  );
}
