import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  CompanyRole,
  isCompanyRole,
  isUserLanguage,
  UserLanguage,
} from "@/lib/company-roles";
import { SESSION_COOKIE_NAME } from "@/lib/auth-security";
import { isValidFirestoreDocumentId } from "@/lib/request-validation";
import {
  isValidEmail,
  isValidFirebaseUid,
  isValidRequiredString,
} from "@/lib/request-validation";
import { projectMembershipDocumentId } from "@/lib/tenant-model";
import {
  canAccessCompany,
  canAccessProject,
} from "@/lib/tenant-policy";

export type PersistedCompanyUser = {
  id: string;
  authUid: string;
  companyId: string;
  name: string;
  email: string;
  role: CompanyRole;
  active: boolean;
  language: UserLanguage;
};

export type CompanyUser = PersistedCompanyUser & { active: true };

export type TenantCompany = {
  id: string;
  name: string;
  code: string;
  active: true;
  defaultLanguage: string;
  supportedLanguages: string[];
};

export type TenantProject = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  description: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export class TenantAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409
  ) {
    super(message);
  }
}

function projectDate(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date })
      .toDate()
      .toISOString()
      .split("T")[0];
  }

  return null;
}

export function parsePersistedCompanyUser(
  documentId: string,
  data: Record<string, unknown> | undefined
): PersistedCompanyUser | null {
  if (
    !isValidFirestoreDocumentId(documentId) ||
    !data ||
    !isValidFirebaseUid(data.authUid) ||
    typeof data.companyId !== "string" ||
    !isValidFirestoreDocumentId(data.companyId) ||
    !isValidRequiredString(data.name, 200) ||
    typeof data.email !== "string" ||
    !isValidEmail(data.email) ||
    !isCompanyRole(data.role) ||
    typeof data.active !== "boolean" ||
    !isUserLanguage(data.language)
  ) {
    return null;
  }

  return {
    id: documentId,
    authUid: data.authUid,
    companyId: data.companyId,
    name: data.name,
    email: data.email,
    role: data.role,
    active: data.active,
    language: data.language,
  };
}

export async function getCurrentCompanyUser(): Promise<CompanyUser | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionCookie) {
      return null;
    }

    const decodedClaims = await adminAuth.verifySessionCookie(
      sessionCookie,
      true
    );
    const snapshot = await adminDb
      .collection("users")
      .where("authUid", "==", decodedClaims.uid)
      .limit(2)
      .get();

    // Duplicate identity links are ambiguous and therefore fail closed.
    if (snapshot.size !== 1) {
      return null;
    }

    const document = snapshot.docs[0];
    const user = parsePersistedCompanyUser(
      document.id,
      document.data()
    );

    if (
      !user ||
      user.active !== true ||
      user.authUid !== decodedClaims.uid
    ) {
      return null;
    }

    return {
      ...user,
      active: true,
    };
  } catch (error) {
    console.error("getCurrentCompanyUser failed:", error);
    return null;
  }
}

export async function requireCompanyAccess(
  companyId: string,
  resolvedUser?: CompanyUser
): Promise<{ user: CompanyUser; company: TenantCompany }> {
  if (!isValidFirestoreDocumentId(companyId)) {
    throw new TenantAccessError("Invalid company ID.", 400);
  }

  const user = resolvedUser ?? (await getCurrentCompanyUser());

  if (!user) {
    throw new TenantAccessError("Tenant authentication required.", 401);
  }

  if (!canAccessCompany(user, companyId)) {
    throw new TenantAccessError("Company access denied.", 403);
  }

  const snapshot = await adminDb.collection("companies").doc(companyId).get();

  if (!snapshot.exists) {
    throw new TenantAccessError("Company not found.", 404);
  }

  const data = snapshot.data();

  if (data?.active !== true) {
    throw new TenantAccessError("Company access denied.", 403);
  }

  return {
    user,
    company: {
      id: snapshot.id,
      name: typeof data.name === "string" ? data.name : "",
      code: typeof data.code === "string" ? data.code : "",
      active: true,
      defaultLanguage:
        typeof data.defaultLanguage === "string"
          ? data.defaultLanguage
          : "ar",
      supportedLanguages: Array.isArray(data.supportedLanguages)
        ? data.supportedLanguages.filter(
            (language): language is string => typeof language === "string"
          )
        : ["ar"],
    },
  };
}

export async function requireProjectAccess(
  projectId: string,
  resolvedUser?: CompanyUser
): Promise<{
  user: CompanyUser;
  company: TenantCompany;
  project: TenantProject;
}> {
  if (!isValidFirestoreDocumentId(projectId)) {
    throw new TenantAccessError("Invalid project ID.", 400);
  }

  const user = resolvedUser ?? (await getCurrentCompanyUser());

  if (!user) {
    throw new TenantAccessError("Tenant authentication required.", 401);
  }

  const projectSnapshot = await adminDb
    .collection("projects")
    .doc(projectId)
    .get();

  if (!projectSnapshot.exists) {
    throw new TenantAccessError("Project not found.", 404);
  }

  const projectData = projectSnapshot.data();
  const projectCompanyId = projectData?.companyId;

  if (!isValidFirestoreDocumentId(projectCompanyId)) {
    throw new TenantAccessError("Project tenant data is invalid.", 409);
  }

  const { company } = await requireCompanyAccess(projectCompanyId, user);
  const membershipId = projectMembershipDocumentId(projectId, user.id);

  if (!membershipId) {
    throw new TenantAccessError("Project membership identity is invalid.", 400);
  }

  const membershipSnapshot = await adminDb
    .collection("projectMembers")
    .doc(membershipId)
    .get();
  const membership = membershipSnapshot.data();

  if (
    !membershipSnapshot.exists ||
    !canAccessProject(
      user,
      { id: projectId, companyId: projectCompanyId },
      membership
    )
  ) {
    throw new TenantAccessError("Project access denied.", 403);
  }

  return {
    user,
    company,
    project: {
      id: projectSnapshot.id,
      companyId: projectCompanyId,
      name: typeof projectData?.name === "string" ? projectData.name : "",
      code: typeof projectData?.code === "string" ? projectData.code : "",
      description:
        typeof projectData?.description === "string"
          ? projectData.description
          : "",
      status:
        typeof projectData?.status === "string"
          ? projectData.status
          : "active",
      startDate: projectDate(projectData?.startDate),
      endDate: projectDate(projectData?.endDate),
    },
  };
}
