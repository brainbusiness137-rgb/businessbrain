export type TenantPolicyUser = {
  id: string;
  companyId: string;
  active: boolean;
};

export type TenantPolicyProject = {
  id: string;
  companyId: string;
};

export type TenantPolicyMembership = {
  companyId?: unknown;
  projectId?: unknown;
  userId?: unknown;
  active?: unknown;
};

export function canAccessCompany(
  user: TenantPolicyUser,
  companyId: string
): boolean {
  return user.active === true && user.companyId === companyId;
}

export function canAccessProject(
  user: TenantPolicyUser,
  project: TenantPolicyProject,
  membership: TenantPolicyMembership | undefined
): boolean {
  return (
    canAccessCompany(user, project.companyId) &&
    membership?.active === true &&
    membership.companyId === user.companyId &&
    membership.projectId === project.id &&
    membership.userId === user.id
  );
}
