import { NextResponse } from "next/server";
import {
  getCurrentCompanyUser,
  requireCompanyAccess,
  requireProjectAccess,
  TenantAccessError,
} from "@/lib/tenant-auth";
import { adminDb } from "@/lib/firebase-admin";

export async function GET() {
  try {
    const user = await getCurrentCompanyUser();

    if (!user) {
      throw new TenantAccessError("Tenant authentication required.", 401);
    }

    const { company } = await requireCompanyAccess(user.companyId, user);
    const memberships = await adminDb
      .collection("projectMembers")
      .where("userId", "==", user.id)
      .get();
    const projectIds = Array.from(
      new Set(
        memberships.docs
          .map((document) => document.data())
          .filter(
            (membership) =>
              membership.active === true &&
              membership.companyId === user.companyId &&
              typeof membership.projectId === "string"
          )
          .map((membership) => membership.projectId as string)
      )
    );
    const projectResults = await Promise.allSettled(
      projectIds.map((projectId) => requireProjectAccess(projectId, user))
    );
    const projects = projectResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.project] : []
    );

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        companyId: user.companyId,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        language: user.language,
      },
      company,
      projects,
    });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: error.status }
      );
    }

    console.error("Tenant context failed:", error);
    return NextResponse.json(
      { success: false, message: "Unable to load tenant context." },
      { status: 500 }
    );
  }
}
