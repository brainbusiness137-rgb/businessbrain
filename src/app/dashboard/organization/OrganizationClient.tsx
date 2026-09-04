"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Company = { id: string; name: string; code: string; active: boolean };
type Unit = {
  id: string;
  companyId: string;
  name: string;
  parentId: string | null;
  active: boolean;
};
type CompanyUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  active: boolean;
};
type Project = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  status: string;
};
type UnitMembership = {
  companyId: string;
  organizationUnitId: string;
  userId: string;
  active: boolean;
};
type ProjectAssignment = {
  companyId: string;
  projectId: string;
  organizationUnitId: string;
  active: boolean;
};
type ApiResponse = {
  message?: string;
  companies?: Company[];
  units?: Unit[];
  users?: CompanyUser[];
  projects?: Project[];
  memberships?: UnitMembership[];
  assignments?: ProjectAssignment[];
};

function aborted(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readResponse(response: Response, fallback: string) {
  let data: ApiResponse = {};
  try {
    data = (await response.json()) as ApiResponse;
  } catch {
    // Use the localized fallback for a non-JSON server response.
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("انتهت الجلسة. سجل الدخول مجددًا.");
    if (response.status === 403) throw new Error("ليس لديك الصلاحية المطلوبة.");
    throw new Error(data.message || fallback);
  }
  return data;
}

export default function OrganizationClient({
  initialCompanyId,
  canManageProjects,
}: {
  initialCompanyId: string;
  canManageProjects: boolean;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [memberships, setMemberships] = useState<UnitMembership[]>([]);
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRelationshipId, setSavingRelationshipId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [editing, setEditing] = useState<Unit | null>(null);

  const companyRef = useRef("");
  const companyGeneration = useRef(0);
  const companyAbort = useRef<AbortController | null>(null);
  const detailIdentity = useRef("");
  const detailGeneration = useRef(0);
  const detailAbort = useRef<AbortController | null>(null);

  function clearFeedback() {
    setMessage("");
    setError("");
  }

  function clearDetails() {
    detailIdentity.current = "";
    detailGeneration.current += 1;
    detailAbort.current?.abort();
    detailAbort.current = null;
    setSelectedUnit(null);
    setMemberships([]);
    setAssignments([]);
    setDetailsLoading(false);
    setSavingRelationshipId("");
  }

  function clearCompanyData() {
    setUnits([]);
    setUsers([]);
    setProjects([]);
    setEditing(null);
    setName("");
    setParentId(null);
    setActive(true);
    clearDetails();
  }

  async function fetchCompanyData(selectedCompanyId: string, signal: AbortSignal) {
    const query = `companyId=${encodeURIComponent(selectedCompanyId)}`;
    const requests = [
      fetch(`/api/admin/organization-units?${query}`, { signal }),
      fetch(`/api/admin/company-users?${query}`, { signal }),
    ];
    if (canManageProjects) {
      requests.push(fetch(`/api/admin/projects?${query}`, { signal }));
    }
    const responses = await Promise.all(requests);
    const [unitData, userData, projectData] = await Promise.all(
      responses.map((response, index) =>
        readResponse(
          response,
          index === 0
            ? "تعذر تحميل الهيكل التنظيمي."
            : index === 1
              ? "تعذر تحميل مستخدمي الشركة."
              : "تعذر تحميل مشاريع الشركة."
        )
      )
    );
    return {
      units: (unitData.units ?? []).filter(
        (unit) => unit.companyId === selectedCompanyId
      ),
      users: (userData.users ?? []).filter(
        (user) => user.companyId === selectedCompanyId
      ),
      projects: (projectData?.projects ?? []).filter(
        (project) => project.companyId === selectedCompanyId
      ),
    };
  }

  async function loadCompany(selectedCompanyId: string) {
    const generation = ++companyGeneration.current;
    const controller = new AbortController();
    companyAbort.current?.abort();
    companyAbort.current = controller;
    setLoading(true);
    try {
      const data = await fetchCompanyData(selectedCompanyId, controller.signal);
      if (
        generation !== companyGeneration.current ||
        companyRef.current !== selectedCompanyId
      ) return;
      setUnits(data.units);
      setUsers(data.users);
      setProjects(data.projects);
    } catch (loadError) {
      if (
        generation !== companyGeneration.current ||
        companyRef.current !== selectedCompanyId ||
        aborted(loadError)
      ) return;
      setUnits([]);
      setUsers([]);
      setProjects([]);
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل بيانات الشركة.");
    } finally {
      if (generation === companyGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function initialize() {
      try {
        const response = await fetch("/api/admin/companies", { signal: controller.signal });
        const data = await readResponse(response, "تعذر تحميل الشركات.");
        const loaded = data.companies ?? [];
        const preferred = loaded.some(({ id }) => id === initialCompanyId)
          ? initialCompanyId
          : loaded[0]?.id ?? "";
        if (cancelled) return;
        setCompanies(loaded);
        setCompanyId(preferred);
        companyRef.current = preferred;
        if (preferred) await loadCompany(preferred);
        else setLoading(false);
      } catch (loadError) {
        if (!cancelled && !aborted(loadError)) {
          setCompanies([]);
          setLoading(false);
          setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الشركات.");
        }
      }
    }
    void initialize();
    return () => {
      cancelled = true;
      controller.abort();
      companyAbort.current?.abort();
      detailAbort.current?.abort();
    };
    // Initial selection is intentionally keyed only by the server-provided query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompanyId]);

  async function changeCompany(nextCompanyId: string) {
    clearFeedback();
    companyRef.current = nextCompanyId;
    setCompanyId(nextCompanyId);
    companyGeneration.current += 1;
    companyAbort.current?.abort();
    clearCompanyData();
    if (nextCompanyId) await loadCompany(nextCompanyId);
    else setLoading(false);
  }

  async function selectUnit(unit: Unit) {
    clearFeedback();
    const identity = JSON.stringify([unit.companyId, unit.id]);
    const generation = ++detailGeneration.current;
    const controller = new AbortController();
    detailAbort.current?.abort();
    detailAbort.current = controller;
    detailIdentity.current = identity;
    setSelectedUnit(unit);
    setMemberships([]);
    setAssignments([]);
    setDetailsLoading(true);
    try {
      const query = `companyId=${encodeURIComponent(unit.companyId)}&organizationUnitId=${encodeURIComponent(unit.id)}`;
      const requests = [
        fetch(`/api/admin/organization-unit-members?${query}`, { signal: controller.signal }),
      ];
      if (canManageProjects) {
        requests.push(fetch(`/api/admin/project-organization-units?${query}`, { signal: controller.signal }));
      }
      const responses = await Promise.all(requests);
      const [memberData, assignmentData] = await Promise.all(
        responses.map((response, index) =>
          readResponse(
            response,
            index === 0 ? "تعذر تحميل أعضاء الوحدة." : "تعذر تحميل مشاريع الوحدة."
          )
        )
      );
      if (
        generation !== detailGeneration.current ||
        detailIdentity.current !== identity ||
        companyRef.current !== unit.companyId
      ) return;
      setMemberships(
        (memberData.memberships ?? []).filter(
          (item) => item.companyId === unit.companyId && item.organizationUnitId === unit.id
        )
      );
      setAssignments(
        (assignmentData?.assignments ?? []).filter(
          (item) => item.companyId === unit.companyId && item.organizationUnitId === unit.id
        )
      );
    } catch (loadError) {
      if (
        generation === detailGeneration.current &&
        detailIdentity.current === identity &&
        companyRef.current === unit.companyId &&
        !aborted(loadError)
      ) {
        setMemberships([]);
        setAssignments([]);
        setError(loadError instanceof Error ? loadError.message : "تعذر تحميل تفاصيل الوحدة.");
      }
    } finally {
      if (generation === detailGeneration.current && detailIdentity.current === identity) {
        setDetailsLoading(false);
      }
    }
  }

  async function saveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    const selectedCompanyId = companyRef.current;
    try {
      setSaving(true);
      const response = await fetch("/api/admin/organization-units", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? { organizationUnitId: editing.id, name, parentId, active }
            : { companyId: selectedCompanyId, name, parentId, active }
        ),
      });
      await readResponse(response, "تعذر حفظ الوحدة التنظيمية.");
      if (companyRef.current !== selectedCompanyId) return;
      clearDetails();
      setEditing(null);
      setName("");
      setParentId(null);
      setActive(true);
      await loadCompany(selectedCompanyId);
      if (companyRef.current === selectedCompanyId) setMessage("تم حفظ الوحدة التنظيمية.");
    } catch (saveError) {
      if (companyRef.current === selectedCompanyId) {
        setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الوحدة التنظيمية.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function updateRelationship(
    kind: "member" | "project",
    targetId: string
  ) {
    if (!selectedUnit) return;
    const identity = JSON.stringify([selectedUnit.companyId, selectedUnit.id]);
    const existing = kind === "member"
      ? memberships.find(({ userId }) => userId === targetId)
      : assignments.find(({ projectId }) => projectId === targetId);
    const nextActive = existing ? !existing.active : true;
    const endpoint = kind === "member"
      ? "/api/admin/organization-unit-members"
      : "/api/admin/project-organization-units";
    clearFeedback();
    try {
      setSavingRelationshipId(`${kind}:${targetId}`);
      const response = await fetch(endpoint, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedUnit.companyId,
          organizationUnitId: selectedUnit.id,
          ...(kind === "member" ? { userId: targetId } : { projectId: targetId }),
          active: nextActive,
        }),
      });
      await readResponse(response, "تعذر تحديث العلاقة.");
      if (detailIdentity.current !== identity) return;
      await selectUnit(selectedUnit);
      if (detailIdentity.current === identity) setMessage("تم تحديث العلاقة بنجاح.");
    } catch (saveError) {
      if (detailIdentity.current === identity) {
        setError(saveError instanceof Error ? saveError.message : "تعذر تحديث العلاقة.");
      }
    } finally {
      setSavingRelationshipId("");
    }
  }

  const descendants = useMemo(() => {
    if (!editing) return new Set<string>();
    const result = new Set<string>();
    const queue = [editing.id];
    while (queue.length) {
      const current = queue.pop();
      if (!current) continue;
      for (const unit of units) {
        if (unit.parentId === current && !result.has(unit.id)) {
          result.add(unit.id);
          queue.push(unit.id);
        }
      }
    }
    return result;
  }, [editing, units]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Unit[]>();
    for (const unit of units) {
      const children = map.get(unit.parentId) ?? [];
      children.push(unit);
      map.set(unit.parentId, children);
    }
    return map;
  }, [units]);

  const hierarchyRows = useMemo(() => {
    const rows: { unit: Unit; depth: number }[] = [];
    const stack = [...(childrenByParent.get(null) ?? [])]
      .reverse()
      .map((unit) => ({ unit, depth: 0 }));
    const visited = new Set<string>();

    while (stack.length) {
      const row = stack.pop();
      if (!row || visited.has(row.unit.id)) continue;
      visited.add(row.unit.id);
      rows.push(row);
      const children = childrenByParent.get(row.unit.id) ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ unit: children[index], depth: row.depth + 1 });
      }
    }

    return rows;
  }, [childrenByParent]);

  const selectedCompany = companies.find(({ id }) => id === companyId);

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold">الهيكل التنظيمي</h1>
        <p className="mt-2 text-sm text-gray-500">أنشئ هيكلًا ديناميكيًا وأدر أعضاء الوحدات وارتباطها بالمشاريع.</p>
        {message && <div role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-green-800">{message}</div>}
        {error && <div role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-red-800">{error}</div>}

        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <label htmlFor="organization-company" className="block text-sm font-medium">الشركة</label>
          <select
            id="organization-company"
            value={companyId}
            onChange={(event) => void changeCompany(event.target.value)}
            className="mt-2 w-full rounded-lg border px-4 py-3 md:max-w-md"
          >
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name} ({company.code})</option>)}
          </select>
        </section>

        {selectedCompany && (
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">{editing ? "تعديل الوحدة التنظيمية" : "إضافة وحدة تنظيمية"}</h2>
              <form onSubmit={saveUnit} className="mt-5 space-y-4">
                <label className="block text-sm font-medium">اسم الوحدة
                  <input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-lg border px-4 py-3" />
                </label>
                <label className="block text-sm font-medium">الوحدة الأم
                  <select value={parentId ?? ""} onChange={(event) => setParentId(event.target.value || null)} className="mt-2 w-full rounded-lg border px-4 py-3">
                    <option value="">بدون — مستوى رئيسي</option>
                    {units.filter((unit) => unit.id !== editing?.id && !descendants.has(unit.id) && unit.active).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> نشطة</label>
                <div className="flex gap-3">
                  <button disabled={saving || !selectedCompany.active} className="rounded-lg bg-black px-5 py-2 text-white disabled:opacity-50">{saving ? "جاري الحفظ..." : "حفظ"}</button>
                  {editing && <button type="button" onClick={() => { setEditing(null); setName(""); setParentId(null); setActive(true); }} className="rounded-lg border px-5 py-2">إلغاء</button>}
                </div>
              </form>
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">شجرة الوحدات</h2>
              {loading ? <p className="mt-5 text-gray-500">جاري التحميل...</p> : hierarchyRows.length ? <div className="mt-5">{hierarchyRows.map(({ unit, depth }) => (
                <div
                  key={unit.id}
                  className={`mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${selectedUnit?.id === unit.id ? "border-black bg-gray-50" : ""}`}
                  style={{ marginInlineStart: `${depth * 20}px` }}
                >
                  <button type="button" onClick={() => void selectUnit(unit)} className="text-right">
                    <span className="font-medium">{unit.name}</span>
                    <span className="mr-2 text-xs text-gray-500">{unit.active ? "نشطة" : "غير نشطة"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(unit);
                      setName(unit.name);
                      setParentId(unit.parentId);
                      setActive(unit.active);
                      clearFeedback();
                    }}
                    className="rounded border px-3 py-1 text-sm"
                  >
                    تعديل
                  </button>
                </div>
              ))}</div> : <p className="mt-5 text-gray-500">لا توجد وحدات تنظيمية. لا يُنشأ أي هيكل افتراضي.</p>}
            </section>
          </div>
        )}

        {selectedUnit && (
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">أعضاء: {selectedUnit.name}</h2>
              {detailsLoading ? <p className="mt-4 text-gray-500">جاري التحميل...</p> : users.length ? (
                <div className="mt-4 space-y-3">{users.map((user) => {
                  const membership = memberships.find(({ userId }) => userId === user.id);
                  const nextActive = !membership || !membership.active;
                  return <div key={user.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div><p className="font-medium">{user.name}</p><p className="text-xs text-gray-500">{user.email} — {membership?.active ? "عضو نشط" : membership ? "عضوية غير نشطة" : "غير معين"}</p></div>
                    <button type="button" disabled={savingRelationshipId === `member:${user.id}` || (nextActive && (!user.active || !selectedUnit.active || !selectedCompany?.active))} onClick={() => void updateRelationship("member", user.id)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{membership?.active ? "تعطيل" : membership ? "تفعيل" : "إضافة"}</button>
                  </div>;
                })}</div>
              ) : <p className="mt-4 text-gray-500">لا يوجد مستخدمون مؤهلون داخل هذه الشركة.</p>}
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">مشاريع الوحدة</h2>
              {!canManageProjects ? <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">تتطلب إدارة ارتباط المشاريع صلاحية إدارة المشاريع.</p> : detailsLoading ? <p className="mt-4 text-gray-500">جاري التحميل...</p> : projects.length ? (
                <div className="mt-4 space-y-3">{projects.map((project) => {
                  const assignment = assignments.find(({ projectId }) => projectId === project.id);
                  const nextActive = !assignment || !assignment.active;
                  return <div key={project.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div><p className="font-medium">{project.name}</p><p className="text-xs text-gray-500">{project.code} — {assignment?.active ? "ارتباط نشط" : assignment ? "ارتباط غير نشط" : "غير مرتبط"}</p></div>
                    <button type="button" disabled={savingRelationshipId === `project:${project.id}` || (nextActive && (project.status !== "active" || !selectedUnit.active || !selectedCompany?.active))} onClick={() => void updateRelationship("project", project.id)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{assignment?.active ? "تعطيل" : assignment ? "تفعيل" : "إضافة"}</button>
                  </div>;
                })}</div>
              ) : <p className="mt-4 text-gray-500">لا توجد مشاريع متاحة داخل هذه الشركة.</p>}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
