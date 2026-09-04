import { NextResponse } from "next/server";
import {
  getCurrentCompanyUser,
  requireCompanyAccess,
  requireProjectAccess,
  TenantAccessError,
} from "@/lib/tenant-auth";
import { adminDb } from "@/lib/firebase-admin";
import {
  filterValidOrganizationHierarchy,
  parsePersistedOrganizationUnit,
  parsePersistedOrganizationUnitMembership,
} from "@/lib/organization-units";

export async function GET() {
  try {
    const user = await getCurrentCompanyUser();

    if (!user) {
      throw new TenantAccessError("Tenant authentication required.", 401);
    }

    const { company } = await requireCompanyAccess(user.companyId, user);
    const [memberships, organizationSnapshot, organizationMembershipSnapshot] =
      await Promise.all([
        adminDb.collection("projectMembers").where("userId", "==", user.id).get(),
        adminDb
          .collection("organizationUnits")
          .where("companyId", "==", user.companyId)
          .get(),
        adminDb
          .collection("organizationUnitMembers")
          .where("userId", "==", user.id)
          .get(),
      ]);
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
    const organizationUnits = filterValidOrganizationHierarchy(
      organizationSnapshot.docs.flatMap((document) => {
        const unit = parsePersistedOrganizationUnit(
          document.id,
          document.data()
        );
        return unit && unit.companyId === user.companyId ? [unit] : [];
      }),
      user.companyId
    )
      .filter((unit) => unit.active)
      .sort((left, right) => left.name.localeCompare(right.name, "ar"));
    const organizationUnitIds = new Set(
      organizationUnits.map((unit) => unit.id)
    );
    const writableOrganizationUnitIds = organizationMembershipSnapshot.docs
      .flatMap((document) => {
        const membership = parsePersistedOrganizationUnitMembership(
          document.id,
          document.data()
        );
        return membership &&
          membership.active &&
          membership.companyId === user.companyId &&
          membership.userId === user.id &&
          organizationUnitIds.has(membership.organizationUnitId)
          ? [membership.organizationUnitId]
          : [];
      });

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
      organizationUnits,
      writableOrganizationUnitIds,
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
