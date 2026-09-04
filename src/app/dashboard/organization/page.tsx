import { requireDashboardPermission } from "@/lib/dashboard-auth";
import { hasPlatformAuthority, PERMISSIONS } from "@/lib/permissions";

import OrganizationClient from "./OrganizationClient";

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string | string[] }>;
}) {
  const actor = await requireDashboardPermission(PERMISSIONS.manageCompanies);
  const query = await searchParams;

  return (
    <OrganizationClient
      initialCompanyId={
        typeof query.companyId === "string" ? query.companyId : ""
      }
      canManageProjects={hasPlatformAuthority(
        actor,
        PERMISSIONS.manageProjects
      )}
    />
  );
}
