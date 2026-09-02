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

export function getDefaultPermissions(
  role: PlatformRole
): Record<Permission, boolean> {
  return {
    ...DEFAULT_ROLE_PERMISSIONS[role],
  };
}