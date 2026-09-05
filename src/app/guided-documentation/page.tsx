import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import LogoutButton from "@/components/LogoutButton";
import { getCurrentCompanyUser } from "@/lib/tenant-auth";
import GuidedDocumentationClient from "./GuidedDocumentationClient";

export default async function GuidedDocumentationPage() {
  const user = await getCurrentCompanyUser();
  if (!user) redirect("/login");
  if (user.role === "president") redirect("/procedures");
  return <main dir="rtl" className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8"><div className="mx-auto max-w-6xl"><header className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm text-slate-500">{user.name}</p><h1 className="text-2xl font-bold">توثيق الإجراءات</h1><p className="mt-1 text-sm text-slate-600">هنوثّق الإجراء خطوة بخطوة بلغة العمل اليومية.</p></div><div className="flex items-center gap-3"><Link href="/procedures" className="rounded-lg border bg-white px-4 py-2">الإجراءات</Link><LogoutButton /></div></header><Suspense fallback={<p>جارٍ تحميل التوثيق…</p>}><GuidedDocumentationClient /></Suspense></div></main>;
}
