import CompanyUsersClient from "./CompanyUsersClient";
import { requireDashboardPermission } from "@/lib/dashboard-auth";
import {
  hasPlatformAuthority,
  PERMISSIONS,
} from "@/lib/permissions";

export default async function CompanyUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string | string[] }>;
}) {
  const actor = await requireDashboardPermission(
    PERMISSIONS.manageCompanies
  );
  const query = await searchParams;
  const initialCompanyId =
    typeof query.companyId === "string" ? query.companyId : "";

  return (
    <CompanyUsersClient
      initialCompanyId={initialCompanyId}
      canManageProjects={hasPlatformAuthority(
        actor,
        PERMISSIONS.manageProjects
      )}
    />
  );
}
