import { ReactNode } from "react";
import { requireDashboardUser } from "@/lib/dashboard-auth";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireDashboardUser();
  return children;
}
