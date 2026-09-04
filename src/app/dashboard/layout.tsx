import { ReactNode } from "react";
import Link from "next/link";
import { requireDashboardUser } from "@/lib/dashboard-auth";
import {
  hasPlatformAuthority,
  PERMISSIONS,
} from "@/lib/permissions";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireDashboardUser();
  const navigation = [
    { href: "/dashboard", label: "الرئيسية", visible: true },
    {
      href: "/dashboard/users",
      label: "مستخدمو المنصة",
      visible: hasPlatformAuthority(user, PERMISSIONS.manageUsers),
    },
    {
      href: "/dashboard/companies",
      label: "الشركات",
      visible: hasPlatformAuthority(user, PERMISSIONS.manageCompanies),
    },
    {
      href: "/dashboard/company-users",
      label: "مستخدمو الشركات",
      visible: hasPlatformAuthority(user, PERMISSIONS.manageCompanies),
    },
    {
      href: "/dashboard/projects",
      label: "المشاريع",
      visible: hasPlatformAuthority(user, PERMISSIONS.manageProjects),
    },
    {
      href: "/dashboard/roles",
      label: "الأدوار والصلاحيات",
      visible: hasPlatformAuthority(user, PERMISSIONS.manageRoles),
    },
  ];

  return (
    <>
      <header dir="rtl" className="border-b bg-white px-6 py-4">
        <nav
          aria-label="التنقل الرئيسي"
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-2"
        >
          {navigation
            .filter((item) => item.visible)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                {item.label}
              </Link>
            ))}
        </nav>
      </header>
      {children}
    </>
  );
}
