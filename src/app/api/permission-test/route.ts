import { NextResponse } from "next/server";
import { getCurrentPlatformUser, hasPermission } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentPlatformUser();

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        message: "Unauthorized",
      },
      { status: 401 }
    );
  }

  const permission = "manageCompanies";
  const allowed = hasPermission(user, permission);

  if (!allowed) {
    return NextResponse.json(
      {
        success: false,
        authorized: false,
        permission,
        message: "You do not have permission to perform this action.",
      },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    authorized: true,
    permission,
    message: "Permission granted.",
  });
}