import { redirect } from "next/navigation";
import Link from "next/link";

import LogoutButton from "@/components/LogoutButton";
import { getCurrentCompanyUser } from "@/lib/tenant-auth";
import ProceduresClient from "./ProceduresClient";

export default async function ProceduresPage() {
  const user = await getCurrentCompanyUser();

  if (!user) redirect("/login");

  return (
    <main dir="rtl" className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">{user.name}</p>
            <h1 className="text-2xl font-bold">إجراءات العمل</h1>
          </div>
          <div className="flex items-center gap-3"><Link href="/guided-documentation" className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white">ابدأ توثيقًا موجّهًا</Link><LogoutButton /></div>
        </header>
        <ProceduresClient />
      </div>
    </main>
  );
}
