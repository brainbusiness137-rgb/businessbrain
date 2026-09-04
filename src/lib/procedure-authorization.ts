import { adminDb } from "@/lib/firebase-admin";
import {
  parsePersistedOrganizationUnit,
  parsePersistedOrganizationUnitMembership,
} from "@/lib/organization-units";
import { PersistedProcedure } from "@/lib/procedures";
import {
  CompanyUser,
  getCurrentCompanyUser,
  parsePersistedCompanyUser,
  requireProjectAccess,
  TenantAccessError,
} from "@/lib/tenant-auth";
import {
  organizationUnitMembershipDocumentId,
  projectMembershipDocumentId,
} from "@/lib/tenant-model";

export class ProcedureAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409
  ) {
    super(message);
  }
}

export async function requireProcedureActor(): Promise<CompanyUser> {
  const actor = await getCurrentCompanyUser();
  if (!actor) {
    throw new ProcedureAccessError("Tenant authentication required.", 401);
  }
  return actor;
}

export async function requireProcedureReadAccess(
  procedure: PersistedProcedure,
  actor: CompanyUser
) {
  try {
    const context = await requireProjectAccess(procedure.projectId, actor);
    if (
      context.company.id !== procedure.companyId ||
      context.project.companyId !== procedure.companyId
    ) {
      throw new ProcedureAccessError("Procedure tenant relationship is invalid.", 409);
    }

    const unitSnapshot = await adminDb
      .collection("organizationUnits")
      .doc(procedure.organizationUnitId)
      .get();
    const unit = unitSnapshot.exists
      ? parsePersistedOrganizationUnit(unitSnapshot.id, unitSnapshot.data())
      : null;
    if (!unit || unit.companyId !== procedure.companyId) {
      throw new ProcedureAccessError("Procedure organization relationship is invalid.", 409);
    }
    return context;
  } catch (error) {
    if (error instanceof ProcedureAccessError) throw error;
    if (error instanceof TenantAccessError) {
      throw new ProcedureAccessError(error.message, error.status);
    }
    throw error;
  }
}

export async function requireProcedureWriteContext(
  transaction: FirebaseFirestore.Transaction,
  sessionActor: CompanyUser,
  companyId: string,
  projectId: string,
  organizationUnitId: string
): Promise<CompanyUser> {
  const membershipId = projectMembershipDocumentId(projectId, sessionActor.id);
  if (!membershipId) {
    throw new ProcedureAccessError("Project membership identity is invalid.", 400);
  }

  const actorRef = adminDb.collection("users").doc(sessionActor.id);
  const companyRef = adminDb.collection("companies").doc(companyId);
  const projectRef = adminDb.collection("projects").doc(projectId);
  const projectMembershipRef = adminDb
    .collection("projectMembers")
    .doc(membershipId);
  const unitRef = adminDb
    .collection("organizationUnits")
    .doc(organizationUnitId);
  const [actorSnapshot, companySnapshot, projectSnapshot, membershipSnapshot, unitSnapshot] =
    await Promise.all([
      transaction.get(actorRef),
      transaction.get(companyRef),
      transaction.get(projectRef),
      transaction.get(projectMembershipRef),
      transaction.get(unitRef),
    ]);
  const actor = actorSnapshot.exists
    ? parsePersistedCompanyUser(actorSnapshot.id, actorSnapshot.data())
    : null;
  const unit = unitSnapshot.exists
    ? parsePersistedOrganizationUnit(unitSnapshot.id, unitSnapshot.data())
    : null;
  const projectMembership = membershipSnapshot.data();

  if (
    !actor ||
    actor.active !== true ||
    actor.authUid !== sessionActor.authUid ||
    actor.companyId !== companyId
  ) {
    throw new ProcedureAccessError("Tenant actor is no longer valid.", 403);
  }
  if (!companySnapshot.exists || companySnapshot.data()?.active !== true) {
    throw new ProcedureAccessError("Active company required.", 403);
  }
  if (!projectSnapshot.exists || projectSnapshot.data()?.companyId !== companyId) {
    throw new ProcedureAccessError("Project relationship is invalid.", 409);
  }
  if (
    !membershipSnapshot.exists ||
    projectMembership?.active !== true ||
    projectMembership.companyId !== companyId ||
    projectMembership.projectId !== projectId ||
    projectMembership.userId !== actor.id
  ) {
    throw new ProcedureAccessError("Active project membership required.", 403);
  }
  if (!unit || unit.companyId !== companyId || unit.active !== true) {
    throw new ProcedureAccessError("Active same-company organization unit required.", 409);
  }
  if (actor.role === "president") {
    throw new ProcedureAccessError("President access is read-only.", 403);
  }
  if (actor.role === "project_manager") return { ...actor, active: true };

  const unitMembershipId = organizationUnitMembershipDocumentId(
    organizationUnitId,
    actor.id
  );
  if (!unitMembershipId) {
    throw new ProcedureAccessError("Organization membership identity is invalid.", 400);
  }
  const unitMembershipSnapshot = await transaction.get(
    adminDb.collection("organizationUnitMembers").doc(unitMembershipId)
  );
  const unitMembership = unitMembershipSnapshot.exists
    ? parsePersistedOrganizationUnitMembership(
        unitMembershipSnapshot.id,
        unitMembershipSnapshot.data()
      )
    : null;
  if (
    !unitMembership ||
    unitMembership.active !== true ||
    unitMembership.companyId !== companyId ||
    unitMembership.organizationUnitId !== organizationUnitId ||
    unitMembership.userId !== actor.id
  ) {
    throw new ProcedureAccessError(
      "Active membership in the primary organization unit is required.",
      403
    );
  }

  return { ...actor, active: true };
}
