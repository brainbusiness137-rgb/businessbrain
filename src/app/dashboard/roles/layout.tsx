import { ReactNode } from "react";
import { requireDashboardPermission } from "@/lib/dashboard-auth";
import { PERMISSIONS } from "@/lib/permissions";

export default async function RolesLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireDashboardPermission(PERMISSIONS.manageRoles);
  return children;
}
