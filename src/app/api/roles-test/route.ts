import { NextResponse } from "next/server";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
} from "@/lib/permissions";

export async function GET() {
  return NextResponse.json({
    success: true,
    roles: {
      [ROLES.platform_owner]:
        DEFAULT_ROLE_PERMISSIONS.platform_owner,

      [ROLES.platform_manager]:
        DEFAULT_ROLE_PERMISSIONS.platform_manager,

      [ROLES.platform_reviewer]:
        DEFAULT_ROLE_PERMISSIONS.platform_reviewer,
    },
  });
}