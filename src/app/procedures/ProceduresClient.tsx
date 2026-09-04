"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Project = { id: string; name: string; code: string };
type Unit = { id: string; name: string; parentId: string | null };
type Procedure = {
  id: string;
  companyId: string;
  projectId: string;
  organizationUnitId: string;
  name: string;
  objective: string;
  description?: string;
  trigger: { type: string; description?: string };
  frequency: { type: string; interval?: number; description?: string };
  status: "draft" | "in_progress" | "ready_for_review";
  active: boolean;
};
type Step = {
  id: string;
  companyId: string;
  projectId: string;
  procedureId: string;
  sequence: number;
  name: string;
  description?: string;
  organizationUnitId?: string;
  active: boolean;
};
type Context = {
  user: { companyId: string; role: string };
  projects: Project[];
  organizationUnits: Unit[];
  writableOrganizationUnitIds: string[];
};

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
const buttonClass = "rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50";

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as { message?: string } & T;
  if (!response.ok) {
    throw new ApiError(body.message ?? "تعذر إكمال الطلب.", response.status);
  }
  return body;
}

export default function ProceduresClient() {
  const [context, setContext] = useState<Context | null>(null);
  const [projectId, setProjectId] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [selected, setSelected] = useState<Procedure | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const procedureGeneration = useRef(0);
  const stepGeneration = useRef(0);

  const handleRequestError = useCallback((reason: unknown, fallback: string) => {
    if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
      ++procedureGeneration.current;
      ++stepGeneration.current;
      setContext(null);
      setProcedures([]);
      setSelected(null);
      setSteps([]);
    }
    setError(reason instanceof Error ? reason.message : fallback);
  }, []);

  useEffect(() => {
    let active = true;
    api<{ success: true } & Context>("/api/tenant/context")
      .then((result) => {
        if (!active) return;
        setContext(result);
        setProjectId(result.projects[0]?.id ?? "");
      })
      .catch((reason: unknown) => {
        if (active) handleRequestError(reason, "تعذر تحميل السياق.");
      });
    return () => { active = false; };
  }, [handleRequestError]);

  const loadProcedures = useCallback(async () => {
    const generation = ++procedureGeneration.current;
    ++stepGeneration.current;
    await Promise.resolve();
    setProcedures([]);
    setSelected(null);
    setSteps([]);
    setError("");
    if (!projectId) return;
    const params = new URLSearchParams({ projectId });
    if (unitFilter) params.set("organizationUnitId", unitFilter);
    if (statusFilter) params.set("status", statusFilter);
    try {
      const result = await api<{ procedures: Procedure[] }>(`/api/tenant/procedures?${params}`);
      if (generation === procedureGeneration.current) setProcedures(result.procedures);
    } catch (reason) {
      if (generation === procedureGeneration.current) {
        handleRequestError(reason, "تعذر تحميل الإجراءات.");
      }
    }
  }, [projectId, unitFilter, statusFilter, handleRequestError]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProcedures(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProcedures]);

  async function openProcedure(procedure: Procedure) {
    const generation = ++stepGeneration.current;
    setSelected(procedure);
    setSteps([]);
    setError("");
    try {
      const result = await api<{ steps: Step[] }>(
        `/api/tenant/procedure-steps?procedureId=${encodeURIComponent(procedure.id)}`
      );
      if (generation === stepGeneration.current) setSteps(result.steps);
    } catch (reason) {
      if (generation === stepGeneration.current) {
        handleRequestError(reason, "تعذر تحميل الخطوات.");
      }
    }
  }

  const canWriteUnit = (unitId: string) =>
    context?.user.role !== "president" &&
    (context?.user.role === "project_manager" ||
      context?.writableOrganizationUnitIds.includes(unitId));
  const canWrite = Boolean(selected && canWriteUnit(selected.organizationUnitId));

  async function createProcedure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !projectId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError("");
    try {
      await api("/api/tenant/procedures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: context.user.companyId,
          projectId,
          organizationUnitId: form.get("organizationUnitId"),
          name: form.get("name"),
          objective: form.get("objective"),
          description: form.get("description") || undefined,
          trigger: { type: form.get("triggerType") },
          frequency: { type: form.get("frequencyType") },
          status: "draft",
          active: true,
        }),
      });
      formElement.reset();
      await loadProcedures();
    } catch (reason) {
      handleRequestError(reason, "تعذر إنشاء الإجراء.");
    } finally { setBusy(false); }
  }

  async function editProcedure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await api("/api/tenant/procedures", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          procedureId: selected.id,
          name: form.get("name"),
          objective: form.get("objective"),
          description: form.get("description") || undefined,
          organizationUnitId: form.get("organizationUnitId"),
          status: form.get("status"),
          active: form.get("active") === "on",
        }),
      });
      await loadProcedures();
    } catch (reason) {
      handleRequestError(reason, "تعذر تحديث الإجراء.");
    } finally { setBusy(false); }
  }

  async function createStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const organizationUnitId = String(form.get("organizationUnitId") ?? "");
    setBusy(true); setError("");
    try {
      await api("/api/tenant/procedure-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selected.companyId,
          projectId: selected.projectId,
          procedureId: selected.id,
          sequence: Number(form.get("sequence")),
          name: form.get("name"),
          description: form.get("description") || undefined,
          organizationUnitId: organizationUnitId || undefined,
          active: true,
        }),
      });
      formElement.reset();
      await openProcedure(selected);
    } catch (reason) {
      handleRequestError(reason, "تعذر إنشاء الخطوة.");
    } finally { setBusy(false); }
  }

  async function toggleStep(step: Step) {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      await api("/api/tenant/procedure-steps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: step.id, active: !step.active }),
      });
      await openProcedure(selected);
    } catch (reason) {
      handleRequestError(reason, "تعذر تحديث الخطوة.");
    } finally { setBusy(false); }
  }

  async function editStep(event: FormEvent<HTMLFormElement>, step: Step) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const organizationUnitId = String(form.get("organizationUnitId") ?? "");
    setBusy(true); setError("");
    try {
      await api("/api/tenant/procedure-steps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: step.id,
          sequence: Number(form.get("sequence")),
          name: form.get("name"),
          description: form.get("description"),
          ...(organizationUnitId ? { organizationUnitId } : {}),
        }),
      });
      await openProcedure(selected);
    } catch (reason) {
      handleRequestError(reason, "تعذر تحديث الخطوة.");
    } finally { setBusy(false); }
  }

  const writableUnits = context?.organizationUnits.filter((unit) => canWriteUnit(unit.id)) ?? [];

  if (!context) {
    return error
      ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>
      : <p>جارٍ تحميل مساحة العمل…</p>;
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">اختيار النطاق</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <select disabled={busy} className={inputClass} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">اختر المشروع</option>
            {context?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <select disabled={busy} className={inputClass} value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
            <option value="">كل الوحدات التنظيمية</option>
            {context?.organizationUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
          <select disabled={busy} className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option><option value="in_progress">قيد الإعداد</option>
            <option value="ready_for_review">جاهز للمراجعة</option>
          </select>
        </div>
      </section>

      {context?.user.role !== "president" && writableUnits.length > 0 && projectId && (
        <details className="rounded-xl border bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">إنشاء إجراء جديد</summary>
          <form onSubmit={createProcedure} className="mt-4 grid gap-3 md:grid-cols-2">
            <input required name="name" maxLength={200} className={inputClass} placeholder="اسم الإجراء" />
            <select required name="organizationUnitId" className={inputClass} defaultValue="">
              <option value="" disabled>الوحدة التنظيمية المالكة</option>
              {writableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
            <textarea required name="objective" maxLength={2000} className={inputClass} placeholder="الهدف" />
            <textarea name="description" maxLength={5000} className={inputClass} placeholder="وصف اختياري" />
            <select name="triggerType" className={inputClass} defaultValue="event">
              <option value="scheduled">مجدول</option><option value="event">حدث</option><option value="request">طلب</option>
              <option value="condition">شرط</option><option value="other">أخرى</option>
            </select>
            <select name="frequencyType" className={inputClass} defaultValue="event_driven">
              <option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly">شهري</option>
              <option value="quarterly">ربع سنوي</option><option value="semiannual">نصف سنوي</option><option value="annual">سنوي</option>
              <option value="event_driven">حسب الحدث</option><option value="on_demand">عند الطلب</option>
              <option value="irregular">غير منتظم</option><option value="other">أخرى</option>
            </select>
            <button disabled={busy} className={`${buttonClass} md:col-span-2`}>حفظ المسودة</button>
          </form>
        </details>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">الإجراءات</h2>
          <div className="space-y-2">
            {procedures.map((procedure) => (
              <button key={procedure.id} type="button" disabled={busy} onClick={() => void openProcedure(procedure)}
                className={`w-full rounded-lg border p-3 text-right ${selected?.id === procedure.id ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}>
                <span className="block font-medium">{procedure.name}</span>
                <span className="text-sm text-slate-500">{procedure.status} · {procedure.active ? "نشط" : "غير نشط"}</span>
              </button>
            ))}
            {projectId && procedures.length === 0 && <p className="text-sm text-slate-500">لا توجد إجراءات في هذا النطاق.</p>}
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          {!selected ? <p className="text-slate-500">افتح إجراءً لعرض تفاصيله وخطواته.</p> : (
            <div className="space-y-5">
              <div><h2 className="text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-slate-600">{selected.objective}</p></div>
              {canWrite && (
                <details>
                  <summary className="cursor-pointer font-medium">تعديل بيانات الإجراء</summary>
                  <form key={selected.id} onSubmit={editProcedure} className="mt-3 grid gap-3 md:grid-cols-2">
                    <input required name="name" maxLength={200} defaultValue={selected.name} className={inputClass} />
                    <select required name="organizationUnitId" defaultValue={selected.organizationUnitId} className={inputClass}>
                      {writableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                    <textarea required name="objective" maxLength={2000} defaultValue={selected.objective} className={inputClass} />
                    <textarea name="description" maxLength={5000} defaultValue={selected.description ?? ""} className={inputClass} />
                    <select name="status" defaultValue={selected.status} className={inputClass}>
                      <option value="draft">مسودة</option><option value="in_progress">قيد الإعداد</option><option value="ready_for_review">جاهز للمراجعة</option>
                    </select>
                    <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={selected.active} /> نشط</label>
                    <button disabled={busy} className={`${buttonClass} md:col-span-2`}>حفظ التعديلات</button>
                  </form>
                </details>
              )}
              <div>
                <h3 className="mb-2 font-semibold">خطوات الإجراء</h3>
                <ol className="space-y-2">
                  {steps.map((step) => (
                    <li key={step.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div><span className="font-medium">{step.sequence}. {step.name}</span>{step.description && <p className="text-sm text-slate-500">{step.description}</p>}</div>
                        {canWrite && <button type="button" disabled={busy} onClick={() => void toggleStep(step)} className="text-sm font-medium text-blue-700">{step.active ? "تعطيل" : "تفعيل"}</button>}
                      </div>
                      {canWrite && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm text-slate-600">تعديل الخطوة</summary>
                          <form onSubmit={(event) => void editStep(event, step)} className="mt-2 grid gap-2 md:grid-cols-2">
                            <input required name="sequence" type="number" min={1} step={1} defaultValue={step.sequence} className={inputClass} />
                            <input required name="name" maxLength={200} defaultValue={step.name} className={inputClass} />
                            <textarea name="description" maxLength={5000} defaultValue={step.description ?? ""} className={inputClass} />
                            <select name="organizationUnitId" defaultValue={step.organizationUnitId ?? ""} className={inputClass}>
                              <option value="">الوحدة المالكة للإجراء</option>
                              {context.organizationUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                            </select>
                            <button disabled={busy} className={`${buttonClass} md:col-span-2`}>حفظ الخطوة</button>
                          </form>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
              {canWrite && (
                <details>
                  <summary className="cursor-pointer font-medium">إضافة خطوة</summary>
                  <form key={`step-${selected.id}`} onSubmit={createStep} className="mt-3 grid gap-3 md:grid-cols-2">
                    <input required name="sequence" type="number" min={1} step={1} className={inputClass} placeholder="الترتيب" />
                    <input required name="name" maxLength={200} className={inputClass} placeholder="اسم الخطوة" />
                    <textarea name="description" maxLength={5000} className={inputClass} placeholder="وصف اختياري" />
                    <select name="organizationUnitId" className={inputClass} defaultValue="">
                      <option value="">الوحدة المالكة للإجراء</option>
                      {context.organizationUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                    <button disabled={busy} className={`${buttonClass} md:col-span-2`}>إضافة الخطوة</button>
                  </form>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
