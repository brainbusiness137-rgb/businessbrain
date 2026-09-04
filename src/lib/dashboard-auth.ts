import { redirect } from "next/navigation";
import { getCurrentPlatformUser, PlatformUser } from "@/lib/auth";
import { hasPlatformAuthority, Permission } from "@/lib/permissions";

export async function requireDashboardUser(): Promise<PlatformUser> {
  const user = await getCurrentPlatformUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireDashboardPermission(
  permission: Permission
): Promise<PlatformUser> {
  const user = await requireDashboardUser();

  if (!hasPlatformAuthority(user, permission)) {
    redirect("/dashboard");
  }

  return user;
}
