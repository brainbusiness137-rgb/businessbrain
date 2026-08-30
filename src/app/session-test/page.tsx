import { cookies } from "next/headers";

export default async function SessionTestPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("businessbrain_session");

  return (
    <main
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-gray-50 px-4"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-2xl font-bold">
          اختبار BusinessBrain Session
        </h1>

        {session ? (
          <div className="mt-6">
            <p className="font-medium text-green-600">
              تم إنشاء Session Cookie بنجاح ✅
            </p>

            <p className="mt-3 text-sm text-gray-600">
              Server يستطيع رؤية Session Cookie.
            </p>
          </div>
        ) : (
          <div className="mt-6">
            <p className="font-medium text-red-600">
              لا توجد Session Cookie ❌
            </p>

            <p className="mt-3 text-sm text-gray-600">
              يجب تسجيل الدخول أولًا.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}