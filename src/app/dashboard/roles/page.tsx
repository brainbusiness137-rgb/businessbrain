"use client";

import { useState } from "react";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  PlatformRole,
  PERMISSIONS,
  PERMISSION_LABELS,
} from "@/lib/permissions";



const roleLabels: Record<PlatformRole, string> = {
  platform_owner: "مالك المنصة",
  platform_manager: "مدير المنصة",
  platform_reviewer: "مراجع المنصة",
};

export default function RolesPage() {
  const [selectedRole, setSelectedRole] =
    useState<PlatformRole>(ROLES.platform_owner);

 
  

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-gray-50 px-6 py-10"
    >
      <div className="mx-auto max-w-6xl">
        <div className="rounded-2xl bg-white p-8 shadow-sm">
          <p className="text-sm text-gray-500">
            BusinessBrain
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            الأدوار والصلاحيات
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            إدارة الصلاحيات الافتراضية لكل دور في المنصة.
          </p>

          <div className="mt-8">
            <label className="mb-2 block text-sm font-medium">
              الدور
            </label>

            <select
              value={selectedRole}
              onChange={(event) =>
                setSelectedRole(
                  event.target.value as PlatformRole
                )
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 outline-none focus:ring-2 sm:max-w-md"
            >
              {Object.values(ROLES).map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-8">
            <h2 className="text-xl font-bold">
              صلاحيات {roleLabels[selectedRole]}
            </h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.values(PERMISSIONS).map(
                (permission) => (
                  <label
                    key={permission}
                    className="flex cursor-pointer items-center justify-between rounded-lg border p-4 hover:bg-gray-50"
                  >
                    <span className="text-sm">
                      {PERMISSION_LABELS[permission]}
                    </span>

                    <input
                      type="checkbox"
                     checked={
  DEFAULT_ROLE_PERMISSIONS[selectedRole][permission] === true
}
readOnly
                      className="h-5 w-5"
                    />
                  </label>
                )
              )}
            </div>
          </div>

       
        </div>
      </div>
    </main>
  );
}