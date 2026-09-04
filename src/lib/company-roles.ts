export const COMPANY_ROLES = {
  project_manager: "project_manager",
  president: "president",
  department_manager: "department_manager",
  section_responsible: "section_responsible",
  employee: "employee",
} as const;

export type CompanyRole =
  (typeof COMPANY_ROLES)[keyof typeof COMPANY_ROLES];

export const USER_LANGUAGES = {
  ar: "ar",
  en: "en",
} as const;

export type UserLanguage =
  (typeof USER_LANGUAGES)[keyof typeof USER_LANGUAGES];

export function isCompanyRole(value: unknown): value is CompanyRole {
  return (
    typeof value === "string" &&
    Object.values(COMPANY_ROLES).includes(value as CompanyRole)
  );
}

export function isUserLanguage(
  value: unknown
): value is UserLanguage {
  return (
    typeof value === "string" &&
    Object.values(USER_LANGUAGES).includes(value as UserLanguage)
  );
}

// Tenant-role permissions are intentionally deferred. This module is the
// boundary for that future policy and must remain separate from platform roles.
