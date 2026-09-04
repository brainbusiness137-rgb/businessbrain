import { ReactNode } from "react";

import { requireDashboardPermission } from "@/lib/dashboard-auth";
import { PERMISSIONS } from "@/lib/permissions";

export default async function OrganizationLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireDashboardPermission(PERMISSIONS.manageCompanies);
  return children;
}
