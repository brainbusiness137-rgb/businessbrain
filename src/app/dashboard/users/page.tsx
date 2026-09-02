"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  PlatformRole,
  PERMISSIONS,
  Permission,
  PERMISSION_LABELS,
} from "@/lib/permissions";

type PlatformUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  permissions: Record<string, boolean>;
};

export default function UsersPage() {
  const router = useRouter();

  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
const [editingUser, setEditingUser] =
  useState<PlatformUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [role, setRole] =
    useState<PlatformRole>(ROLES.platform_reviewer);

  const permissions =
    DEFAULT_ROLE_PERMISSIONS[role];
async function handleToggleActive(user: PlatformUser) {
  try {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: user.id,
        active: !user.active,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Failed to update user status"
      );
    }

    setUsers((currentUsers) =>
      currentUsers.map((currentUser) =>
        currentUser.id === user.id
          ? {
              ...currentUser,
              active: !currentUser.active,
            }
          : currentUser
      )
    );

    setMessage(
      user.active
        ? "تم تعطيل المستخدم بنجاح."
        : "تم تفعيل المستخدم بنجاح."
    );
  } catch (error) {
    console.error(error);

    setMessage(
      error instanceof Error
        ? error.message
        : "حدث خطأ أثناء تحديث حالة المستخدم."
    );
  }
}
  async function loadUsers() {
    try {
      setLoading(true);

      const response = await fetch("/api/admin/users");

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Failed to load users"
        );
      }

      setUsers(data.users || []);
    } catch (error) {
      console.error(error);
      setMessage("تعذر تحميل المستخدمين.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreateUser(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");
    setCreating(true);

    try {
      const response = await fetch(
        "/api/admin/users",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
       body: JSON.stringify({
  name,
  email,
  password,
  role,
}),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Failed to create user"
        );
      }

      setMessage("تم إنشاء المستخدم بنجاح.");

      setName("");
      setEmail("");
      setPassword("");
      setRole(ROLES.platform_reviewer);

      await loadUsers();

      router.refresh();
    } catch (error) {
      console.error(error);

      setMessage(
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء إنشاء المستخدم."
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-gray-50 px-6 py-10"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="text-sm text-gray-500">
            BusinessBrain
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            إدارة المستخدمين
          </h1>

          <p className="mt-2 text-gray-500">
            إنشاء وإدارة مستخدمي المنصة.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Create User */}
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">
              إضافة مستخدم
            </h2>

            <form
              onSubmit={handleCreateUser}
              className="mt-6 space-y-5"
            >
              <div>
                <label className="mb-2 block text-sm font-medium">
                  الاسم
                </label>

                <input
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  required
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2"
                  placeholder="اسم المستخدم"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  البريد الإلكتروني
                </label>

                <input
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  required
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2"
                  placeholder="user@example.com"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  كلمة المرور
                </label>

                <input
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2"
                  placeholder="6 أحرف على الأقل"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  الدور
                </label>

                <select
                  value={role}
                  onChange={(event) =>
                    setRole(
                      event.target.value as PlatformRole
                    )
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 outline-none focus:ring-2"
                >
                  <option value={ROLES.platform_owner}>
                    Platform Owner
                  </option>

                  <option value={ROLES.platform_manager}>
                    Platform Manager
                  </option>

                  <option value={ROLES.platform_reviewer}>
                    Platform Reviewer
                  </option>
                </select>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-lg bg-black px-4 py-3 font-medium text-white disabled:opacity-50"
              >
                {creating
                  ? "جاري إنشاء المستخدم..."
                  : "إنشاء المستخدم"}
              </button>

              {message && (
                <p className="text-center text-sm font-medium">
                  {message}
                </p>
              )}
            </form>
          </section>

          {/* Permissions Preview */}
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">
              الصلاحيات الافتراضية
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              الصلاحيات التي سيحصل عليها المستخدم عند
              اختياره لهذا الدور.
            </p>

            <div className="mt-6 space-y-3">
              {Object.entries(permissions).map(
                ([permission, enabled]) => (
                  <div
                    key={permission}
                    className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3"
                  >
                    <span className="text-sm">
                      {permission}
                    </span>

                    <span
                      className={
                        enabled
                          ? "font-medium text-green-600"
                          : "text-gray-400"
                      }
                    >
                      {enabled ? "مفعلة" : "غير مفعلة"}
                    </span>
                  </div>
                )
              )}
            </div>
          </section>
{editingUser && (
  <p className="mb-4 text-sm text-blue-600">
    جاري تعديل: {editingUser.name}
  </p>
)}
{editingUser && (
  <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold">
      تعديل المستخدم
    </h2>

    <div className="mt-5">
      <label className="mb-2 block text-sm font-medium">
        الاسم
      </label>

      <input
        value={editingUser.name}
        onChange={(event) =>
          setEditingUser({
            ...editingUser,
            name: event.target.value,
          })
        }
        className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2"
        placeholder="اسم المستخدم"
      />
    </div>
    <div className="mt-5">
  <label className="mb-2 block text-sm font-medium">
    الدور
  </label>

  <select
    value={editingUser.role}
    onChange={(event) => {
  const newRole = event.target.value as PlatformRole;

  setEditingUser({
    ...editingUser,
    role: newRole,
    permissions: {
      ...DEFAULT_ROLE_PERMISSIONS[newRole],
    },
  });
}}
    className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2"
  >
    {Object.entries(ROLES).map(([key, value]) => (
      <option key={key} value={value}>
        {value}
      </option>
    ))}
  </select>
</div>
<div className="mt-5">
  <label className="mb-3 block text-sm font-medium">
    صلاحيات المستخدم
  </label>

  <div className="grid gap-3 sm:grid-cols-2">
    {Object.values(PERMISSIONS).map((permission) => (
      <label
        key={permission}
        className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
      >
        <span className="text-sm">
          {PERMISSION_LABELS[permission]}
        </span>

        <input
          type="checkbox"
          checked={editingUser.permissions?.[permission] === true}
          onChange={() =>
            setEditingUser({
              ...editingUser,
              permissions: {
                ...editingUser.permissions,
                [permission]:
                  editingUser.permissions?.[permission] !== true,
              },
            })
          }
          className="h-5 w-5"
        />
      </label>
    ))}
  </div>
</div>
    {/* كلمة المرور الجديدة */}
    <div className="mt-5">
      <label className="mb-2 block text-sm font-medium">
        كلمة المرور الجديدة
      </label>

      <input
        type="password"
        value={newPassword}
        onChange={(event) =>
          setNewPassword(event.target.value)
        }
        className="w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:ring-2"
        placeholder="اتركها فارغة إذا لم ترد تغيير كلمة المرور"
      />

      <p className="mt-2 text-xs text-gray-500">
        يجب أن تكون كلمة المرور الجديدة 6 أحرف على الأقل.
      </p>
    </div>
    <button
  type="button"
  onClick={async () => {
  if (!editingUser) return;

  try {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
    body: JSON.stringify({
  userId: editingUser.id,
  name: editingUser.name,
  role: editingUser.role,
  permissions: editingUser.permissions,
  ...(newPassword.trim()
    ? { password: newPassword }
    : {}),
}),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Failed to update user"
      );
    }

    setUsers((currentUsers) =>
      currentUsers.map((currentUser) =>
        currentUser.id === editingUser.id
         ? {
    ...currentUser,
    name: editingUser.name,
    role: editingUser.role,
    permissions: editingUser.permissions,
  }
          : currentUser
      )
    );

    setMessage("تم تحديث بيانات المستخدم بنجاح.");
    setEditingUser(null);
  } catch (error) {
    console.error(error);

    setMessage(
      error instanceof Error
        ? error.message
        : "حدث خطأ أثناء تحديث المستخدم."
    );
  }
}}
  className="mt-4 rounded-lg bg-black px-5 py-3 text-sm font-medium text-white hover:bg-gray-800"
>
  حفظ التعديل
</button>
  </div>
)}
          {/* Users */}
          <section className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-3">
            <h2 className="text-xl font-bold">
              المستخدمون
            </h2>

            {loading ? (
              <p className="mt-6 text-gray-500">
                جاري تحميل المستخدمين...
              </p>
            ) : (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-right">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      <th className="px-6 py-4">
                        الاسم
                      </th>

                      <th className="px-6 py-4">
                        البريد
                      </th>

                      <th className="px-6 py-4">
                        الدور
                      </th>

                      <th className="px-6 py-4">
                        الحالة
                      </th>
                      <th className="px-6 py-4">
  إجراء
</th>
                    </tr>
                  </thead>

                  <tbody>
                    {users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-6 py-4 font-medium">
                          {user.name}
                        </td>

                        <td className="px-6 py-4 text-gray-600">
                          {user.email}
                        </td>

                        <td className="px-6 py-4">
                          {user.role}
                        </td>

                        <td className="px-6 py-4">
                          {user.active ? (
                            <span className="font-medium text-green-600">
                              نشط
                            </span>
                          ) : (
                            <span className="font-medium text-red-600">
                              غير نشط
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
  <button
    type="button"
    onClick={() => handleToggleActive(user)}
    className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50"
  >
    {user.active ? "تعطيل" : "تفعيل"}
  </button>
 <button
  type="button"
  onClick={() => setEditingUser(user)}
  className="mr-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50"
>
  تعديل
</button>
</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}