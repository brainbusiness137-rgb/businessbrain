import { adminDb } from "@/lib/firebase-admin";
import { DocumentationSession, parsePersistedSession } from "@/lib/guided-documentation";
import { parsePersistedOrganizationUnitMembership } from "@/lib/organization-units";
import { CompanyUser, getCurrentCompanyUser, parsePersistedCompanyUser, requireProjectAccess, TenantAccessError } from "@/lib/tenant-auth";
import { organizationUnitMembershipDocumentId, projectMembershipDocumentId } from "@/lib/tenant-model";
import { requireProcedureWriteContext } from "@/lib/procedure-authorization";
import { canAccessRawQualitySession } from "@/lib/quality-authorization";

export class GuidedAccessError extends Error {
  constructor(message: string, public readonly status: 400 | 401 | 403 | 404 | 409) { super(message); }
}
export async function requireGuidedActor() {
  const actor = await getCurrentCompanyUser();
  if (!actor) throw new GuidedAccessError("Tenant authentication required.", 401);
  if (actor.role === "president") throw new GuidedAccessError("Raw interview access is not permitted.", 403);
  return actor;
}
export function canAccessRawSession(actor: CompanyUser, session: DocumentationSession) {
  return canAccessRawQualitySession(actor, session);
}
export async function requireSessionAccess(sessionId: string, actor: CompanyUser) {
  const snapshot = await adminDb.collection("documentationSessions").doc(sessionId).get();
  const session = snapshot.exists ? parsePersistedSession(snapshot.id, snapshot.data()) : null;
  if (!session) throw new GuidedAccessError("Documentation session not found.", 404);
  if (!canAccessRawSession(actor, session)) throw new GuidedAccessError("Documentation session not found.", 404);
  try { const context = await requireProjectAccess(session.projectId, actor); if (context.company.id !== session.companyId || context.project.companyId !== session.companyId) throw new GuidedAccessError("Documentation session not found.", 404); } catch (error) { if (error instanceof GuidedAccessError) throw error; if (error instanceof TenantAccessError) throw new GuidedAccessError("Documentation session not found.", 404); throw error; }
  const membershipId = organizationUnitMembershipDocumentId(session.organizationUnitId, actor.id);
  if (actor.role !== "project_manager") {
    if (!membershipId) throw new GuidedAccessError("Documentation session not found.", 404);
    const membershipSnapshot = await adminDb.collection("organizationUnitMembers").doc(membershipId).get();
    const membership = membershipSnapshot.exists ? parsePersistedOrganizationUnitMembership(membershipSnapshot.id, membershipSnapshot.data()) : null;
    if (!membership || !membership.active || membership.companyId !== session.companyId || membership.userId !== actor.id || membership.organizationUnitId !== session.organizationUnitId) throw new GuidedAccessError("Documentation session not found.", 404);
  }
  return session;
}
export async function requireSessionWriteContext(transaction: FirebaseFirestore.Transaction, actor: CompanyUser, session: DocumentationSession) {
  if (!canAccessRawSession(actor, session)) throw new GuidedAccessError("Documentation session access denied.", 403);
  return requireProcedureWriteContext(transaction, actor, session.companyId, session.projectId, session.organizationUnitId);
}
export async function validateSubject(transaction: FirebaseFirestore.Transaction, actor: CompanyUser, companyId: string, projectId: string, organizationUnitId: string, subjectType: "user" | "organization_unit", subjectUserId?: string) {
  if (actor.role === "employee" && (subjectType !== "user" || subjectUserId !== actor.id)) throw new GuidedAccessError("Employees may document only their own work.", 403);
  if (subjectType === "organization_unit") return;
  if (!subjectUserId) throw new GuidedAccessError("A subject user is required.", 400);
  const subjectSnapshot = await transaction.get(adminDb.collection("users").doc(subjectUserId));
  const subject = subjectSnapshot.exists ? parsePersistedCompanyUser(subjectSnapshot.id, subjectSnapshot.data()) : null;
  if (!subject || !subject.active || subject.companyId !== companyId) throw new GuidedAccessError("Subject user must be active and belong to the company.", 409);
  const projectMemberId = projectMembershipDocumentId(projectId, subject.id);
  if (!projectMemberId) throw new GuidedAccessError("Subject project membership is invalid.", 409);
  const projectMemberSnapshot = await transaction.get(adminDb.collection("projectMembers").doc(projectMemberId));
  const projectMembership = projectMemberSnapshot.data();
  const validProjectMembership = projectMemberSnapshot.exists && projectMembership?.active === true && projectMembership.companyId === companyId && projectMembership.projectId === projectId && projectMembership.userId === subject.id;
  const unitMembershipId = organizationUnitMembershipDocumentId(organizationUnitId, subject.id);
  if (!unitMembershipId) throw new GuidedAccessError("Subject organization membership is invalid.", 409);
  const unitSnapshot = await transaction.get(adminDb.collection("organizationUnitMembers").doc(unitMembershipId));
  const unitMembership = unitSnapshot.exists ? parsePersistedOrganizationUnitMembership(unitSnapshot.id, unitSnapshot.data()) : null;
  if (!validProjectMembership || !unitMembership || !unitMembership.active || unitMembership.companyId !== companyId || unitMembership.organizationUnitId !== organizationUnitId || unitMembership.userId !== subject.id) throw new GuidedAccessError("Subject must have active project and organization-unit membership.", 409);
}
