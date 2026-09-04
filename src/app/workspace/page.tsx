import { redirect } from "next/navigation";

import { getCurrentPlatformUser } from "@/lib/auth";
import { getCurrentCompanyUser } from "@/lib/tenant-auth";

export default async function WorkspacePage() {
  const platformUser = await getCurrentPlatformUser();
  if (platformUser) redirect("/dashboard");

  const companyUser = await getCurrentCompanyUser();
  if (companyUser) redirect("/procedures");

  redirect("/login");
}
