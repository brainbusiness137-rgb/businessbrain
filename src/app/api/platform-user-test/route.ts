import { NextResponse } from "next/server";
import { getCurrentPlatformUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentPlatformUser();

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        authenticated: false,
        message: "Unauthorized",
      },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    authenticated: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      authUid: user.authUid,
      role: user.role,
      active: user.active,
      permissions: user.permissions,
    },
  });
}