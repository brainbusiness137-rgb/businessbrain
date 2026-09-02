export const PERMISSIONS = {
  manageUsers: "manageUsers",
  manageRoles: "manageRoles",
  managePermissions: "managePermissions",

  manageCompanies: "manageCompanies",
  manageProjects: "manageProjects",

  createProcess: "createProcess",
  editProcess: "editProcess",
  submitProcess: "submitProcess",
  reviewProcess: "reviewProcess",
  approveProcess: "approveProcess",

  viewAuditLogs: "viewAuditLogs",
} as const;

export type Permission =
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const PERMISSION_LABELS: Record<Permission, string> = {
  manageUsers: "إدارة المستخدمين",
  manageRoles: "إدارة الأدوار",
  managePermissions: "إدارة الصلاحيات",
  manageCompanies: "إدارة الشركات",
  manageProjects: "إدارة المشاريع",
  createProcess: "إنشاء إجراء",
  editProcess: "تعديل إجراء",
  submitProcess: "إرسال إجراء للمراجعة",
  reviewProcess: "مراجعة الإجراءات",
  approveProcess: "اعتماد الإجراءات",
  viewAuditLogs: "عرض سجل العمليات",
};
export const ROLES = {
  platform_owner: "platform_owner",
  platform_manager: "platform_manager",
  platform_reviewer: "platform_reviewer",
} as const;

export type PlatformRole =
  (typeof ROLES)[keyof typeof ROLES];

const ROLE_RANK: Record<PlatformRole, number> = {
  platform_owner: 3,
  platform_manager: 2,
  platform_reviewer: 1,
};

export const DEFAULT_ROLE_PERMISSIONS: Record<
  PlatformRole,
  Record<Permission, boolean>
> = {
  platform_owner: {
    manageUsers: true,
    manageRoles: true,
    managePermissions: true,

    manageCompanies: true,
    manageProjects: true,

    createProcess: true,
    editProcess: true,
    submitProcess: true,
    reviewProcess: true,
    approveProcess: true,

    viewAuditLogs: true,
  },

  platform_manager: {
    manageUsers: true,
    manageRoles: false,
    managePermissions: false,

    manageCompanies: true,
    manageProjects: true,

    createProcess: true,
    editProcess: true,
    submitProcess: true,
    reviewProcess: true,
    approveProcess: false,

    viewAuditLogs: true,
  },

  platform_reviewer: {
    manageUsers: false,
    manageRoles: false,
    managePermissions: false,

    manageCompanies: false,
    manageProjects: false,

    createProcess: false,
    editProcess: false,
    submitProcess: false,
    reviewProcess: true,
    approveProcess: true,

    viewAuditLogs: true,
  },
};

// Defaults describe newly assigned values. Ceilings are the security boundary
// for individual overrides and intentionally remain a separate policy concept.
export const ROLE_PERMISSION_CEILINGS: Record<
  PlatformRole,
  Record<Permission, boolean>
> = {
  platform_owner: {
    ...DEFAULT_ROLE_PERMISSIONS.platform_owner,
  },
  platform_manager: {
    ...DEFAULT_ROLE_PERMISSIONS.platform_manager,
    manageRoles: false,
    managePermissions: false,
  },
  platform_reviewer: {
    ...DEFAULT_ROLE_PERMISSIONS.platform_reviewer,
  },
};

export function isPlatformRole(value: unknown): value is PlatformRole {
  return (
    typeof value === "string" &&
    Object.values(ROLES).includes(value as PlatformRole)
  );
}

export function isPermission(value: string): value is Permission {
  return Object.values(PERMISSIONS).includes(value as Permission);
}

type PlatformPolicyUser = {
  role: string;
  permissions: Record<string, boolean>;
};

export function canManagePlatformUser(
  actor: PlatformPolicyUser,
  targetRole: unknown
): boolean {
  if (
    !isPlatformRole(actor.role) ||
    !isPlatformRole(targetRole) ||
    actor.role === ROLES.platform_reviewer ||
    targetRole === ROLES.platform_owner
  ) {
    return false;
  }

  return ROLE_RANK[actor.role] >= ROLE_RANK[targetRole];
}

export function canAssignPlatformRole(
  actor: PlatformPolicyUser,
  requestedRole: unknown
): requestedRole is PlatformRole {
  if (
    !isPlatformRole(actor.role) ||
    !isPlatformRole(requestedRole) ||
    actor.role === ROLES.platform_reviewer ||
    requestedRole === ROLES.platform_owner
  ) {
    return false;
  }

  return ROLE_RANK[actor.role] >= ROLE_RANK[requestedRole];
}

export function canModifyPlatformRole(
  actor: PlatformPolicyUser,
  targetRole: unknown,
  requestedRole: unknown
): requestedRole is PlatformRole {
  return (
    hasPlatformAuthority(actor, PERMISSIONS.manageRoles) &&
    canManagePlatformUser(actor, targetRole) &&
    canAssignPlatformRole(actor, requestedRole)
  );
}

export function canModifyPlatformPermissions(
  actor: PlatformPolicyUser,
  targetRole: unknown
): boolean {
  return (
    hasPlatformAuthority(actor, PERMISSIONS.managePermissions) &&
    canManagePlatformUser(actor, targetRole)
  );
}

export function isPermissionWithinRoleCeiling(
  role: PlatformRole,
  permission: Permission
): boolean {
  return ROLE_PERMISSION_CEILINGS[role][permission] === true;
}

export function canActorGrantPermission(
  actor: PlatformPolicyUser,
  permission: Permission
): boolean {
  return hasPlatformAuthority(actor, permission);
}

export function hasPlatformAuthority(
  actor: PlatformPolicyUser,
  permission: Permission
): boolean {
  return (
    isPlatformRole(actor.role) &&
    ROLE_PERMISSION_CEILINGS[actor.role][permission] === true &&
    actor.permissions[permission] === true
  );
}

export function getDefaultPermissions(
  role: PlatformRole
): Record<Permission, boolean> {
  return {
    ...DEFAULT_ROLE_PERMISSIONS[role],
  };
}

export function getGrantableDefaultPermissions(
  actor: PlatformPolicyUser,
  role: PlatformRole,
  currentPermissions: Record<string, boolean> = {}
): Record<Permission, boolean> {
  const permissions = getDefaultPermissions(role);

  for (const permission of Object.values(PERMISSIONS)) {
    const becomesGranted =
      permissions[permission] === true &&
      currentPermissions[permission] !== true;

    if (
      permissions[permission] === true &&
      !isPermissionWithinRoleCeiling(role, permission)
    ) {
      permissions[permission] = false;
    } else if (
      becomesGranted &&
      !canActorGrantPermission(actor, permission)
    ) {
      permissions[permission] = false;
    }
  }

  return permissions;
}
