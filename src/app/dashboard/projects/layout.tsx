import { ReactNode } from "react";
import { requireDashboardPermission } from "@/lib/dashboard-auth";
import { PERMISSIONS } from "@/lib/permissions";

export default async function ProjectsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireDashboardPermission(PERMISSIONS.manageProjects);
  return children;
}
