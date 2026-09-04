"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const COMPANY_ROLE_OPTIONS = [
  { value: "project_manager", label: "مسؤول المشروع" },
  { value: "president", label: "الرئيس" },
  { value: "department_manager", label: "مدير الإدارة" },
  { value: "section_responsible", label: "مسؤول القسم" },
  { value: "employee", label: "موظف" },
] as const;

type CompanyRole = (typeof COMPANY_ROLE_OPTIONS)[number]["value"];
type UserLanguage = "ar" | "en";

type Company = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};

type CompanyUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: CompanyRole;
  active: boolean;
  language: UserLanguage;
};

type Project = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  status: string;
};

type Membership = {
  companyId: string;
  projectId: string;
  userId: string;
  active: boolean;
};

type JsonResponse = {
  message?: string;
  companies?: Company[];
  users?: CompanyUser[];
  projects?: Project[];
  memberships?: Membership[];
};

function roleLabel(role: CompanyRole): string {
  return (
    COMPANY_ROLE_OPTIONS.find((option) => option.value === role)?.label ??
    "دور غير معروف"
  );
}

function languageLabel(language: UserLanguage): string {
  return language === "ar" ? "العربية" : "الإنجليزية";
}

function isAbortedRequest(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readResponse(
  response: Response,
  fallbackMessage: string
): Promise<JsonResponse> {
  let data: JsonResponse = {};

  try {
    data = (await response.json()) as JsonResponse;
  } catch {
    // A non-JSON server response is handled by the localized fallback below.
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
    }

    if (response.status === 403) {
      throw new Error("ليس لديك الصلاحية المطلوبة لتنفيذ هذا الإجراء.");
    }

    throw new Error(data.message || fallbackMessage);
  }

  return data;
}

export default function CompanyUsersClient({
  initialCompanyId,
  canManageProjects,
}: {
  initialCompanyId: string;
  canManageProjects: boolean;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [authUid, setAuthUid] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CompanyRole>("employee");
  const [language, setLanguage] = useState<UserLanguage>("ar");
  const [active, setActive] = useState(true);
  const [editingUser, setEditingUser] = useState<CompanyUser | null>(null);

  const [membershipUser, setMembershipUser] =
    useState<CompanyUser | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [membershipSavingId, setMembershipSavingId] = useState("");
  const selectedCompanyRef = useRef("");
  const companyRequestGenerationRef = useRef(0);
  const companyRequestAbortRef = useRef<AbortController | null>(null);
  const membershipIdentityRef = useRef("");
  const membershipRequestGenerationRef = useRef(0);
  const membershipRequestAbortRef = useRef<AbortController | null>(null);

  async function fetchUsers(
    companyId: string,
    signal?: AbortSignal
  ): Promise<CompanyUser[]> {
    const response = await fetch(
      `/api/admin/company-users?companyId=${encodeURIComponent(companyId)}`,
      { signal }
    );
    const data = await readResponse(
      response,
      "تعذر تحميل مستخدمي الشركة."
    );
    return data.users ?? [];
  }

  useEffect(() => {
    let cancelled = false;
    const generation = ++companyRequestGenerationRef.current;
    const controller = new AbortController();
    companyRequestAbortRef.current?.abort();
    companyRequestAbortRef.current = controller;

    async function loadInitialData() {
      try {
        const response = await fetch("/api/admin/companies", {
          signal: controller.signal,
        });
        const data = await readResponse(response, "تعذر تحميل الشركات.");
        const loadedCompanies = data.companies ?? [];
        const preferredCompany = loadedCompanies.some(
          (company) => company.id === initialCompanyId
        )
          ? initialCompanyId
          : loadedCompanies[0]?.id ?? "";
        selectedCompanyRef.current = preferredCompany;
        const loadedUsers = preferredCompany
          ? await fetchUsers(preferredCompany, controller.signal)
          : [];

        if (
          !cancelled &&
          generation === companyRequestGenerationRef.current &&
          selectedCompanyRef.current === preferredCompany
        ) {
          setCompanies(loadedCompanies);
          setSelectedCompanyId(preferredCompany);
          setUsers(loadedUsers);
        }
      } catch (loadError) {
        if (
          !cancelled &&
          generation === companyRequestGenerationRef.current &&
          !isAbortedRequest(loadError)
        ) {
          setCompanies([]);
          setUsers([]);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "حدث خطأ غير متوقع أثناء تحميل الصفحة."
          );
        }
      } finally {
        if (
          !cancelled &&
          generation === companyRequestGenerationRef.current
        ) {
          setLoading(false);
        }
      }
    }

    void loadInitialData();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [initialCompanyId]);

  function clearFeedback() {
    setMessage("");
    setError("");
  }

  async function refreshUsers(companyId = selectedCompanyId) {
    if (!companyId) return;

    const generation = ++companyRequestGenerationRef.current;
    const controller = new AbortController();
    companyRequestAbortRef.current?.abort();
    companyRequestAbortRef.current = controller;

    try {
      setUsersLoading(true);
      const loadedUsers = await fetchUsers(companyId, controller.signal);

      if (
        generation !== companyRequestGenerationRef.current ||
        selectedCompanyRef.current !== companyId
      ) {
        return;
      }

      setUsers(loadedUsers);
      setEditingUser((current) =>
        current
          ? loadedUsers.find((user) => user.id === current.id) ?? null
          : null
      );
      setMembershipUser((current) =>
        current
          ? loadedUsers.find((user) => user.id === current.id) ?? null
          : null
      );
    } catch (loadError) {
      if (
        generation !== companyRequestGenerationRef.current ||
        selectedCompanyRef.current !== companyId ||
        isAbortedRequest(loadError)
      ) {
        return;
      }

      setUsers([]);
      throw loadError;
    } finally {
      if (generation === companyRequestGenerationRef.current) {
        setUsersLoading(false);
      }
    }
  }

  function clearMembershipState() {
    membershipIdentityRef.current = "";
    membershipRequestGenerationRef.current += 1;
    membershipRequestAbortRef.current?.abort();
    membershipRequestAbortRef.current = null;
    setMembershipUser(null);
    setProjects([]);
    setMemberships([]);
    setMembershipsLoading(false);
    setMembershipSavingId("");
  }

  async function handleCompanyChange(companyId: string) {
    clearFeedback();
    selectedCompanyRef.current = companyId;
    setSelectedCompanyId(companyId);
    setUsers([]);
    setEditingUser(null);
    clearMembershipState();
    setAuthUid("");
    setName("");
    setEmail("");
    setRole("employee");
    setLanguage("ar");
    setActive(true);

    if (!companyId) {
      return;
    }

    try {
      await refreshUsers(companyId);
    } catch (loadError) {
      if (selectedCompanyRef.current === companyId) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "تعذر تحميل مستخدمي الشركة."
        );
      }
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    const companyId = selectedCompanyRef.current;

    try {
      setSaving(true);
      const response = await fetch("/api/admin/company-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authUid,
          companyId,
          name,
          email,
          role,
          language,
          active,
        }),
      });
      await readResponse(response, "تعذر إضافة مستخدم الشركة.");

      if (selectedCompanyRef.current !== companyId) return;

      setAuthUid("");
      setName("");
      setEmail("");
      setRole("employee");
      setLanguage("ar");
      setActive(true);
      await refreshUsers(companyId);

      if (selectedCompanyRef.current === companyId) {
        setMessage("تمت إضافة مستخدم الشركة بنجاح.");
      }
    } catch (saveError) {
      if (selectedCompanyRef.current === companyId) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "حدث خطأ غير متوقع أثناء إضافة المستخدم."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveUserUpdates() {
    if (!editingUser) return;
    clearFeedback();
    const companyId = editingUser.companyId;

    try {
      setSaving(true);
      const response = await fetch("/api/admin/company-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editingUser.id,
          name: editingUser.name,
          role: editingUser.role,
          language: editingUser.language,
          active: editingUser.active,
        }),
      });
      await readResponse(response, "تعذر تحديث مستخدم الشركة.");

      if (selectedCompanyRef.current !== companyId) return;

      await refreshUsers(companyId);

      if (selectedCompanyRef.current !== companyId) return;

      setEditingUser(null);
      setMessage("تم تحديث مستخدم الشركة بنجاح.");
    } catch (saveError) {
      if (selectedCompanyRef.current === companyId) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "حدث خطأ غير متوقع أثناء تحديث المستخدم."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function openMemberships(user: CompanyUser) {
    clearFeedback();
    const identity = JSON.stringify([user.companyId, user.id]);
    const generation = ++membershipRequestGenerationRef.current;
    const controller = new AbortController();
    membershipRequestAbortRef.current?.abort();
    membershipRequestAbortRef.current = controller;
    membershipIdentityRef.current = identity;
    setMembershipUser(user);
    setProjects([]);
    setMemberships([]);
    setMembershipsLoading(false);
    setMembershipSavingId("");

    if (!canManageProjects) return;

    try {
      setMembershipsLoading(true);
      const query = `companyId=${encodeURIComponent(user.companyId)}`;
      const [projectsResponse, membershipsResponse] = await Promise.all([
        fetch(`/api/admin/projects?${query}`, { signal: controller.signal }),
        fetch(
          `/api/admin/project-members?${query}&userId=${encodeURIComponent(user.id)}`,
          { signal: controller.signal }
        ),
      ]);
      const [projectsData, membershipsData] = await Promise.all([
        readResponse(projectsResponse, "تعذر تحميل مشاريع الشركة."),
        readResponse(membershipsResponse, "تعذر تحميل عضويات المشاريع."),
      ]);

      if (
        generation !== membershipRequestGenerationRef.current ||
        membershipIdentityRef.current !== identity ||
        selectedCompanyRef.current !== user.companyId
      ) {
        return;
      }

      setProjects(
        (projectsData.projects ?? []).filter(
          (project) => project.companyId === user.companyId
        )
      );
      setMemberships(
        (membershipsData.memberships ?? []).filter(
          (membership) =>
            membership.companyId === user.companyId &&
            membership.userId === user.id
        )
      );
    } catch (loadError) {
      if (
        generation === membershipRequestGenerationRef.current &&
        membershipIdentityRef.current === identity &&
        selectedCompanyRef.current === user.companyId &&
        !isAbortedRequest(loadError)
      ) {
        setProjects([]);
        setMemberships([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "حدث خطأ غير متوقع أثناء تحميل العضويات."
        );
      }
    } finally {
      if (
        generation === membershipRequestGenerationRef.current &&
        membershipIdentityRef.current === identity
      ) {
        setMembershipsLoading(false);
      }
    }
  }

  async function updateMembership(project: Project) {
    if (!membershipUser || project.companyId !== membershipUser.companyId) {
      setError("لا يمكن إدارة عضوية مشروع تابع لشركة أخرى.");
      return;
    }

    const membership = memberships.find(
      (item) => item.projectId === project.id
    );
    const nextActive = membership ? !membership.active : true;
    const identity = JSON.stringify([
      membershipUser.companyId,
      membershipUser.id,
    ]);
    clearFeedback();

    try {
      setMembershipSavingId(project.id);
      const response = await fetch("/api/admin/project-members", {
        method: membership ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: membershipUser.companyId,
          projectId: project.id,
          userId: membershipUser.id,
          active: nextActive,
        }),
      });
      await readResponse(response, "تعذر تحديث عضوية المشروع.");

      if (
        membershipIdentityRef.current !== identity ||
        selectedCompanyRef.current !== membershipUser.companyId
      ) {
        return;
      }

      await openMemberships(membershipUser);

      if (membershipIdentityRef.current === identity) {
        setMessage(
          membership
            ? nextActive
              ? "تم تفعيل عضوية المشروع."
              : "تم تعطيل عضوية المشروع."
            : "تمت إضافة عضوية المشروع."
        );
      }
    } catch (saveError) {
      if (membershipIdentityRef.current === identity) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "حدث خطأ غير متوقع أثناء تحديث العضوية."
        );
      }
    } finally {
      setMembershipSavingId("");
    }
  }

  const selectedCompany = companies.find(
    (company) => company.id === selectedCompanyId
  );

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-sm text-gray-500">BusinessBrain</p>
          <h1 className="mt-2 text-3xl font-bold">مستخدمو الشركات</h1>
          <p className="mt-2 text-sm text-gray-500">
            إدارة حسابات الشركات وربطها بالمشاريع المتاحة داخل الشركة.
          </p>
        </div>

        {message && (
          <div role="status" className="mb-6 rounded-lg bg-green-50 p-4 text-green-800">
            {message}
          </div>
        )}
        {error && (
          <div role="alert" className="mb-6 rounded-lg bg-red-50 p-4 text-red-800">
            {error}
          </div>
        )}

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <label htmlFor="company-filter" className="mb-2 block text-sm font-medium">
            الشركة
          </label>
          {loading ? (
            <p className="text-gray-500">جاري تحميل الشركات...</p>
          ) : companies.length === 0 ? (
            <p className="text-gray-500">لا توجد شركات متاحة حتى الآن.</p>
          ) : (
            <select
              id="company-filter"
              value={selectedCompanyId}
              onChange={(event) => void handleCompanyChange(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 md:max-w-md"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name} ({company.code}){company.active ? "" : " — غير نشطة"}
                </option>
              ))}
            </select>
          )}
        </section>

        {selectedCompany && (
          <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">إضافة مستخدم شركة</h2>
            <p className="mt-2 text-sm text-amber-700">
              يجب أن يكون حساب Firebase Authentication موجودًا مسبقًا، ويجب أن
              يطابق البريد الإلكتروني هوية الحساب. ستضاف الدعوات الآلية لاحقًا.
            </p>
            <form onSubmit={handleCreateUser} className="mt-6 grid gap-5 md:grid-cols-2">
              <label className="text-sm font-medium">
                Firebase Auth UID
                <input required value={authUid} onChange={(event) => setAuthUid(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-left" dir="ltr" />
              </label>
              <label className="text-sm font-medium">
                الاسم
                <input required value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3" />
              </label>
              <label className="text-sm font-medium">
                البريد الإلكتروني
                <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 text-left" dir="ltr" />
              </label>
              <label className="text-sm font-medium">
                دور الشركة
                <select value={role} onChange={(event) => setRole(event.target.value as CompanyRole)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3">
                  {COMPANY_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                اللغة
                <select value={language} onChange={(event) => setLanguage(event.target.value as UserLanguage)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3">
                  <option value="ar">العربية</option>
                  <option value="en">الإنجليزية</option>
                </select>
              </label>
              <label className="flex items-center gap-3 self-end rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium">
                <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
                إنشاء المستخدم بحالة نشطة
              </label>
              <div className="md:col-span-2">
                <button type="submit" disabled={saving || !selectedCompany.active} className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white disabled:opacity-50">
                  {saving ? "جاري الحفظ..." : "إضافة مستخدم الشركة"}
                </button>
                {!selectedCompany.active && <p className="mt-2 text-sm text-red-600">لا يمكن إضافة مستخدم إلى شركة غير نشطة.</p>}
              </div>
            </form>
          </section>
        )}

        {editingUser && (
          <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">تعديل مستخدم الشركة</h2>
            <p className="mt-2 text-sm text-gray-500">{editingUser.email}</p>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <label className="text-sm font-medium">الاسم<input value={editingUser.name} onChange={(event) => setEditingUser({ ...editingUser, name: event.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3" /></label>
              <label className="text-sm font-medium">دور الشركة<select value={editingUser.role} onChange={(event) => setEditingUser({ ...editingUser, role: event.target.value as CompanyRole })} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3">{COMPANY_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="text-sm font-medium">اللغة<select value={editingUser.language} onChange={(event) => setEditingUser({ ...editingUser, language: event.target.value as UserLanguage })} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3"><option value="ar">العربية</option><option value="en">الإنجليزية</option></select></label>
              <label className="flex items-center gap-3 self-end rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium"><input type="checkbox" checked={editingUser.active} onChange={(event) => setEditingUser({ ...editingUser, active: event.target.checked })} />مستخدم نشط</label>
              <div className="flex gap-3 md:col-span-2"><button type="button" disabled={saving} onClick={() => void saveUserUpdates()} className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white disabled:opacity-50">{saving ? "جاري الحفظ..." : "حفظ التعديلات"}</button><button type="button" disabled={saving} onClick={() => setEditingUser(null)} className="rounded-lg border px-6 py-3 text-sm">إلغاء</button></div>
            </div>
          </section>
        )}

        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">مستخدمو الشركة</h2>
          {usersLoading ? <p className="mt-6 text-gray-500">جاري تحميل المستخدمين...</p> : !selectedCompanyId ? <p className="mt-6 text-gray-500">اختر شركة لعرض مستخدميها.</p> : users.length === 0 ? <p className="mt-6 text-gray-500">لا يوجد مستخدمون مسجلون لهذه الشركة.</p> : (
            <div className="mt-6 overflow-x-auto"><table className="w-full text-right"><thead><tr className="border-b text-sm text-gray-500"><th className="px-3 py-3">المستخدم</th><th className="px-3 py-3">الشركة</th><th className="px-3 py-3">الدور</th><th className="px-3 py-3">اللغة</th><th className="px-3 py-3">الحالة</th><th className="px-3 py-3">الإجراءات</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-b"><td className="px-3 py-4"><div className="font-medium">{user.name}</div><div className="mt-1 text-xs text-gray-500" dir="ltr">{user.email}</div></td><td className="px-3 py-4">{selectedCompany?.name}</td><td className="px-3 py-4">{roleLabel(user.role)}</td><td className="px-3 py-4">{languageLabel(user.language)}</td><td className="px-3 py-4">{user.active ? "نشط" : "غير نشط"}</td><td className="px-3 py-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { clearFeedback(); setEditingUser(user); }} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">تعديل</button><button type="button" onClick={() => void openMemberships(user)} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">عضويات المشاريع</button></div></td></tr>)}</tbody></table></div>
          )}
        </section>

        {membershipUser && (
          <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">عضويات المشاريع</h2>
            <div className="mt-4 rounded-xl border bg-gray-50 p-4"><p className="font-bold">{membershipUser.name}</p><p className="mt-1 text-sm text-gray-600">الشركة: {selectedCompany?.name}</p><p className="mt-1 text-sm text-gray-600">الدور: {roleLabel(membershipUser.role)}</p></div>
            {!canManageProjects ? <p className="mt-6 rounded-lg bg-amber-50 p-4 text-amber-800">يمكنك إدارة ملف المستخدم، لكن إدارة عضويات المشاريع تتطلب صلاحية إدارة المشاريع.</p> : membershipsLoading ? <p className="mt-6 text-gray-500">جاري تحميل المشاريع والعضويات...</p> : projects.length === 0 ? <p className="mt-6 text-gray-500">لا توجد مشاريع لهذه الشركة.</p> : (
              <div className="mt-6 space-y-3">{memberships.length === 0 && <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">لا توجد عضويات لهذا المستخدم. اختر مشروعًا لإضافة أول عضوية.</p>}{projects.map((project) => { const membership = memberships.find((item) => item.projectId === project.id); const status = membership ? membership.active ? "عضو نشط" : "عضوية غير نشطة" : "ليس عضوًا"; const activationBlocked = membership?.active !== true && (!membershipUser.active || project.status !== "active"); return <div key={project.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{membership?.active ? "✓" : "○"} {project.name}</p><p className="mt-1 text-sm text-gray-500">{project.code} — {status}</p></div><button type="button" disabled={membershipSavingId === project.id || activationBlocked} onClick={() => void updateMembership(project)} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">{membershipSavingId === project.id ? "جاري الحفظ..." : membership ? membership.active ? "تعطيل العضوية" : "تفعيل العضوية" : "إضافة العضوية"}</button></div>; })}</div>
            )}
            {canManageProjects && !membershipUser.active && <p className="mt-4 text-sm text-amber-700">يجب تفعيل مستخدم الشركة قبل تفعيل عضوياته.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
