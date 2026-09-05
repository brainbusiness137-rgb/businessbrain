import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { GuidedAccessError, requireGuidedActor, requireSessionWriteContext } from "@/lib/guided-authorization";
import { DocumentationSession } from "@/lib/guided-documentation";
import { exactQuery, guidedError } from "@/lib/guided-store";
import { parsePersistedOrganizationUnitMembership } from "@/lib/organization-units";
import { isValidFirestoreDocumentId } from "@/lib/request-validation";
import { parsePersistedCompanyUser } from "@/lib/tenant-auth";
import { projectMembershipDocumentId } from "@/lib/tenant-model";

export async function GET(request: Request) {
  try {
    const actor = await requireGuidedActor(); const params = new URL(request.url).searchParams;
    if (!exactQuery(params, ["projectId", "organizationUnitId"])) throw new GuidedAccessError("Project and organization unit are required.", 400);
    const projectId = params.get("projectId"); const organizationUnitId = params.get("organizationUnitId");
    if (!projectId || !organizationUnitId || !isValidFirestoreDocumentId(projectId) || !isValidFirestoreDocumentId(organizationUnitId)) throw new GuidedAccessError("Invalid subject scope.", 400);
    const users = await adminDb.runTransaction(async (transaction) => {
      const scope = { id: "authorization-only", companyId: actor.companyId, projectId, organizationUnitId, subjectType: "user", subjectUserId: actor.id, phase: "discovery", status: "active", engineVersion: "guided-v1", discoveryPromptSetVersion: "discovery-v1", active: true, createdBy: `users/${actor.id}`, updatedBy: `users/${actor.id}` } satisfies DocumentationSession;
      await requireSessionWriteContext(transaction, actor, scope);
      if (actor.role === "employee") return [{ id: actor.id, name: actor.name, email: actor.email }];
      const memberships = await transaction.get(adminDb.collection("organizationUnitMembers").where("organizationUnitId", "==", organizationUnitId).limit(101));
      if (memberships.size > 100) throw new GuidedAccessError("Organization member list exceeds the guided-session limit.", 409);
      const valid = memberships.docs.flatMap((document) => { const member = parsePersistedOrganizationUnitMembership(document.id, document.data()); return member && member.active && member.companyId === actor.companyId && member.organizationUnitId === organizationUnitId ? [member] : []; });
      const result = [] as Array<{ id: string; name: string; email: string }>;
      for (const member of valid) {
        const membershipId = projectMembershipDocumentId(projectId, member.userId); if (!membershipId) continue;
        const [userSnapshot, projectSnapshot] = await Promise.all([transaction.get(adminDb.collection("users").doc(member.userId)), transaction.get(adminDb.collection("projectMembers").doc(membershipId))]);
        const user = userSnapshot.exists ? parsePersistedCompanyUser(userSnapshot.id, userSnapshot.data()) : null; const projectMember = projectSnapshot.data();
        if (user?.active && user.companyId === actor.companyId && projectSnapshot.exists && projectMember?.active === true && projectMember.companyId === actor.companyId && projectMember.projectId === projectId && projectMember.userId === user.id) result.push({ id: user.id, name: user.name, email: user.email });
      }
      return result.sort((left, right) => left.name.localeCompare(right.name, "ar"));
    });
    return NextResponse.json({ success: true, users, allowOrganizationUnitSubject: actor.role !== "employee" });
  } catch (error) { return guidedError(error); }
}
