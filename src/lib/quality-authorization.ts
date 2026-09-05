import type { DocumentationSession } from "@/lib/guided-documentation";
import type { CompanyUser } from "@/lib/tenant-auth";

export function canAccessRawQualitySession(actor: CompanyUser, session: DocumentationSession) {
  if (actor.companyId !== session.companyId || actor.role === "president") return false;
  if (actor.role === "project_manager") return true;
  if (actor.role === "employee") return session.subjectType === "user" && session.subjectUserId === actor.id;
  return true;
}
