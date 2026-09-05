"use client";

import { useEffect, useState } from "react";

type Finding = { id: string; severity: "blocking" | "warning" | "suggestion"; message: string; subject: { type: string; id: string; stepSequence?: number }; remediation?: { target: string; targetId?: string; questionId?: string; section?: string } };
type Assessment = { assessmentType: "discovery" | "procedure_detail"; state: string; counts: { blocking: number; warning: number; suggestion: number }; coverage?: { applicable: number; answered: number }; findings: Finding[] };
const groups = [{ severity: "blocking", title: "لازم نكملها" }, { severity: "warning", title: "مهمة للمراجعة" }, { severity: "suggestion", title: "تحسينات مقترحة" }] as const;

export default function QualityPanel({ url, refreshKey }: { url: string | null; refreshKey?: string | number }) {
  const requestKey = `${url ?? ""}|${refreshKey ?? ""}`;
  const [result, setResult] = useState<{ key: string; assessment?: Assessment; error?: string }>({ key: "" });
  useEffect(() => { const controller = new AbortController(); if (!url) return () => controller.abort();
    fetch(url, { signal: controller.signal, cache: "no-store" }).then(async (response) => { const body = await response.json() as { assessment?: Assessment; message?: string }; if (!response.ok || !body.assessment) throw new Error(body.message ?? "تعذر تحميل مراجعة الجودة."); return body.assessment; }).then((assessment) => setResult({ key: requestKey, assessment })).catch((reason: unknown) => { if (!controller.signal.aborted) setResult({ key: requestKey, error: reason instanceof Error ? reason.message : "تعذر تحميل مراجعة الجودة." }); }); return () => controller.abort();
  }, [url, requestKey]);
  if (!url) return null; if (result.key === requestKey && result.error) return <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold">مراجعة الجودة</h3><p className="mt-1 text-sm text-amber-900">{result.error}</p></section>; const assessment = result.key === requestKey ? result.assessment : undefined; if (!assessment) return <section className="rounded-xl border bg-white p-4 text-sm text-slate-500">جارٍ مراجعة اكتمال التوثيق…</section>;
  const headline = assessment.counts.blocking ? `في ${assessment.counts.blocking} نقاط محتاجة استكمال قبل ما الإجراء يكون جاهز للمراجعة` : assessment.counts.warning || assessment.counts.suggestion ? "التوثيق مؤهل للمراجعة، وفيه تحسينات مقترحة" : "التوثيق مستوفي نقاط الجودة الحالية";
  return <section id="quality" className="rounded-xl border bg-white p-4 shadow-sm"><h3 className="font-bold">مراجعة الاكتمال والجودة</h3><p className="mt-1 text-slate-700">{headline}</p>{assessment.coverage && <div className="mt-3 rounded-lg bg-blue-50 p-3"><p className="font-medium text-blue-900">تغطية أسئلة الاستكشاف</p><p className="text-sm text-blue-800">{assessment.coverage.answered} من {assessment.coverage.applicable} ({assessment.coverage.applicable ? Math.round(assessment.coverage.answered / assessment.coverage.applicable * 100) : 100}%)</p></div>}<div className="mt-4 space-y-4">{groups.map((group) => { const items = assessment.findings.filter((item) => item.severity === group.severity); return items.length ? <div key={group.severity}><h4 className="font-semibold">{group.title}</h4><ul className="mt-2 space-y-2">{items.map((item) => <li key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm"><p>{item.message}</p>{item.subject.stepSequence && <p className="mt-1 text-xs text-slate-500">الخطوة {item.subject.stepSequence}</p>}</li>)}</ul></div> : null; })}</div></section>;
}
