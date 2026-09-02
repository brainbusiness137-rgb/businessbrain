"use client";

import { FormEvent, useEffect, useState } from "react";

type Company = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};

type Project = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  description: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export default function ProjectsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [companyId, setCompanyId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
const [editingProject, setEditingProject] =
  useState<Project | null>(null);

const [saving, setSaving] = useState(false);
  async function loadData() {
    try {
      setLoading(true);
      setMessage("");

      const [companiesResponse, projectsResponse] =
        await Promise.all([
          fetch("/api/admin/companies"),
          fetch("/api/admin/projects"),
        ]);

      const companiesData = await companiesResponse.json();
      const projectsData = await projectsResponse.json();

      if (!companiesResponse.ok) {
        throw new Error(
          companiesData.message ||
            "حدث خطأ أثناء تحميل الشركات."
        );
      }

      if (!projectsResponse.ok) {
        throw new Error(
          projectsData.message ||
            "حدث خطأ أثناء تحميل المشاريع."
        );
      }

      setCompanies(companiesData.companies ?? []);
      setProjects(projectsData.projects ?? []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء تحميل البيانات."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreateProject(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    try {
      setCreating(true);
      setMessage("");

      const response = await fetch("/api/admin/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          name,
          code,
          description,
          startDate,
          endDate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "حدث خطأ أثناء إنشاء المشروع."
        );
      }

      setName("");
      setCode("");
      setDescription("");
      setStartDate("");
      setEndDate("");

      setMessage("تم إنشاء المشروع بنجاح.");

      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء إنشاء المشروع."
      );
    } finally {
      setCreating(false);
    }
  }

  function getCompanyName(projectCompanyId: string) {
    const company = companies.find(
      (item) => item.id === projectCompanyId
    );

    return company?.name ?? "شركة غير معروفة";
  }

  const activeCompanies = companies.filter(
    (company) => company.active
  );
async function handleSaveProject() {
  if (!editingProject) return;

  try {
    setSaving(true);
    setMessage("");

    const response = await fetch("/api/admin/projects", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: editingProject.id,
        name: editingProject.name,
        description: editingProject.description,
        startDate: editingProject.startDate,
        endDate: editingProject.endDate,
        status: editingProject.status,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "حدث خطأ أثناء تحديث المشروع."
      );
    }

    setEditingProject(null);
    setMessage("تم تحديث المشروع بنجاح.");

    await loadData();
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : "حدث خطأ أثناء تحديث المشروع."
    );
  } finally {
    setSaving(false);
  }
}
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-gray-50 px-6 py-10"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-sm text-gray-500">
            BusinessBrain
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            إدارة المشاريع
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            إنشاء وإدارة مشاريع الشركات المسجلة على المنصة.
          </p>
        </div>

        {message && (
          <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
            {message}
          </div>
        )}

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            إضافة مشروع جديد
          </h2>

          <form
            onSubmit={handleCreateProject}
            className="mt-6 grid gap-5 md:grid-cols-2"
          >
            <div>
              <label className="mb-2 block text-sm font-medium">
                الشركة
              </label>

              <select
                value={companyId}
                onChange={(event) =>
                  setCompanyId(event.target.value)
                }
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
              >
                <option value="">
                  اختر الشركة
                </option>

                {activeCompanies.map((company) => (
                  <option
                    key={company.id}
                    value={company.id}
                  >
                    {company.name} ({company.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                اسم المشروع
              </label>

              <input
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                placeholder="مثال: توثيق إجراءات الشركة"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                كود المشروع
              </label>

              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value)
                }
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                placeholder="مثال: DOC2026"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                تاريخ البداية
              </label>

              <input
                type="date"
                value={startDate}
                onChange={(event) =>
                  setStartDate(event.target.value)
                }
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                تاريخ النهاية
              </label>

              <input
                type="date"
                value={endDate}
                onChange={(event) =>
                  setEndDate(event.target.value)
                }
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium">
                وصف المشروع
              </label>

              <textarea
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value)
                }
                className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3"
                placeholder="وصف مختصر للمشروع"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating
                  ? "جاري إنشاء المشروع..."
                  : "إنشاء المشروع"}
              </button>
            </div>
          </form>
        </section>
{editingProject && (
  <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold">
      تعديل المشروع
    </h2>

    <div className="mt-6 grid gap-5 md:grid-cols-2">
      <div>
        <label className="mb-2 block text-sm font-medium">
          اسم المشروع
        </label>

        <input
          value={editingProject.name}
          onChange={(event) =>
            setEditingProject({
              ...editingProject,
              name: event.target.value,
            })
          }
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          كود المشروع
        </label>

        <input
          value={editingProject.code}
          disabled
          className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-3"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          تاريخ البداية
        </label>

        <input
          type="date"
          value={editingProject.startDate ?? ""}
          onChange={(event) =>
            setEditingProject({
              ...editingProject,
              startDate: event.target.value,
            })
          }
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          تاريخ النهاية
        </label>

        <input
          type="date"
          value={editingProject.endDate ?? ""}
          onChange={(event) =>
            setEditingProject({
              ...editingProject,
              endDate: event.target.value,
            })
          }
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          الحالة
        </label>

        <select
          value={editingProject.status}
          onChange={(event) =>
            setEditingProject({
              ...editingProject,
              status: event.target.value,
            })
          }
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
        >
          <option value="active">نشط</option>
          <option value="inactive">غير نشط</option>
          <option value="completed">مكتمل</option>
        </select>
      </div>

      <div className="md:col-span-2">
        <label className="mb-2 block text-sm font-medium">
          وصف المشروع
        </label>

        <textarea
          value={editingProject.description}
          onChange={(event) =>
            setEditingProject({
              ...editingProject,
              description: event.target.value,
            })
          }
          className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3"
        />
      </div>

      <div className="flex gap-3 md:col-span-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSaveProject}
          className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => setEditingProject(null)}
          className="rounded-lg border px-6 py-3 text-sm"
        >
          إلغاء
        </button>
      </div>
    </div>
  </section>
)}
        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            المشاريع
          </h2>

          {loading ? (
            <p className="mt-6 text-gray-500">
              جاري تحميل المشاريع...
            </p>
          ) : projects.length === 0 ? (
            <p className="mt-6 text-gray-500">
              لا توجد مشاريع حتى الآن.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="border-b text-sm text-gray-500">
                    <th className="px-3 py-3">
                      المشروع
                    </th>
                    <th className="px-3 py-3">
                      الشركة
                    </th>
                    <th className="px-3 py-3">
                      الكود
                    </th>
                    <th className="px-3 py-3">
                      البداية
                    </th>
                    <th className="px-3 py-3">
                      النهاية
                    </th>
                    <th className="px-3 py-3">
                      الحالة
                    </th>
                    <th className="px-3 py-3">
  الإجراءات
</th>
                  </tr>
                </thead>

                <tbody>
                  {projects.map((project) => (
                    <tr
                      key={project.id}
                      className="border-b"
                    >
                      <td className="px-3 py-4">
                        <div className="font-medium">
                          {project.name}
                        </div>

                        {project.description && (
                          <div className="mt-1 text-xs text-gray-500">
                            {project.description}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-4">
                        {getCompanyName(
                          project.companyId
                        )}
                      </td>

                      <td className="px-3 py-4">
                        {project.code}
                      </td>

                      <td className="px-3 py-4">
                        {project.startDate || "-"}
                      </td>

                      <td className="px-3 py-4">
                        {project.endDate || "-"}
                      </td>

                      <td className="px-3 py-4">
                        {project.status === "active"
                          ? "نشط"
                          : project.status}
                      </td>
                      <td className="px-3 py-4">
  <button
    type="button"
    onClick={() => {
      setEditingProject(project);
      setMessage("");
    }}
    className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
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
    </main>
  );
}