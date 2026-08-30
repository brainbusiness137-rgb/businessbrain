import { redirect } from "next/navigation";
import { getCurrentPlatformUser } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
export default async function DashboardPage() {
  const user = await getCurrentPlatformUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-gray-50 px-6 py-10"
    >
      <div className="mx-auto max-w-6xl">
<div className="rounded-2xl bg-white p-8 shadow-sm">
  <div className="flex items-center justify-between">
    <p className="text-sm text-gray-500">
      BusinessBrain Dashboard
    </p>

    <LogoutButton />
  </div>

          <h1 className="mt-2 text-3xl font-bold">
            مرحبًا، {user.name}
          </h1>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border p-5">
              <p className="text-sm text-gray-500">
                الدور
              </p>

              <p className="mt-2 font-semibold">
                {user.role}
              </p>
            </div>

            <div className="rounded-xl border p-5">
              <p className="text-sm text-gray-500">
                حالة الحساب
              </p>

              <p className="mt-2 font-semibold text-green-600">
                نشط
              </p>
            </div>

            <div className="rounded-xl border p-5">
              <p className="text-sm text-gray-500">
                عدد الصلاحيات
              </p>

              <p className="mt-2 font-semibold">
                {Object.keys(user.permissions).length}
              </p>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="text-xl font-bold">
              الصلاحيات
            </h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(user.permissions).map(
                ([permission, enabled]) => (
                  <div
                    key={permission}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <span className="text-sm">
                      {permission}
                    </span>

                    <span
                      className={
                        enabled
                          ? "text-sm font-medium text-green-600"
                          : "text-sm font-medium text-red-600"
                      }
                    >
                      {enabled ? "مفعلة" : "غير مفعلة"}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}