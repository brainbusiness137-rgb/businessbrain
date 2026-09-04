"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type Company = {
  id: string;
  name: string;
  code: string;
  description: string;
  brandColor: string;
  brandColorName: string;
  defaultLanguage: string;
  supportedLanguages: string[];
  contactEmail: string;
  contactPhone: string;
  active: boolean;
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
const [editingCompany, setEditingCompany] =
  useState<Company | null>(null);

const [saving, setSaving] = useState(false);
  async function loadCompanies() {
    try {
      setLoading(true);

      const response = await fetch("/api/admin/companies");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "حدث خطأ أثناء تحميل الشركات."
        );
      }

      setCompanies(data.companies ?? []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء تحميل الشركات."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  async function handleCreateCompany(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    try {
      setCreating(true);
      setMessage("");

      const response = await fetch("/api/admin/companies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          code,
          description,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "حدث خطأ أثناء إنشاء الشركة."
        );
      }

      setName("");
      setCode("");
      setDescription("");

      setMessage("تم إنشاء الشركة بنجاح.");

      await loadCompanies();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء إنشاء الشركة."
      );
    } finally {
      setCreating(false);
    }
  }
async function toggleCompanyActive(company: Company) {
  try {
    setMessage("");

    const response = await fetch("/api/admin/companies", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyId: company.id,
        active: !company.active,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "حدث خطأ أثناء تحديث الشركة."
      );
    }

    setCompanies((currentCompanies) =>
      currentCompanies.map((currentCompany) =>
        currentCompany.id === company.id
          ? {
              ...currentCompany,
              active: !company.active,
            }
          : currentCompany
      )
    );

    setMessage(
      company.active
        ? "تم تعطيل الشركة."
        : "تم تفعيل الشركة."
    );
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : "حدث خطأ أثناء تحديث الشركة."
    );
  }
}
async function handleSaveCompany() {
  if (!editingCompany) return;

  try {
    setSaving(true);
    setMessage("");

    const response = await fetch("/api/admin/companies", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyId: editingCompany.id,
        name: editingCompany.name,
        description: editingCompany.description,
        brandColor: editingCompany.brandColor,
        brandColorName: editingCompany.brandColorName,
        defaultLanguage: editingCompany.defaultLanguage,
        supportedLanguages: editingCompany.supportedLanguages,
        contactEmail: editingCompany.contactEmail,
        contactPhone: editingCompany.contactPhone,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "حدث خطأ أثناء تحديث الشركة."
      );
    }

    setCompanies((currentCompanies) =>
      currentCompanies.map((company) =>
        company.id === editingCompany.id
          ? data.company
          : company
      )
    );

    setEditingCompany(null);
    setMessage("تم تحديث بيانات الشركة بنجاح.");
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : "حدث خطأ أثناء تحديث الشركة."
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
            إدارة الشركات
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            إنشاء وإدارة الشركات المسجلة على المنصة.
          </p>
        </div>

        {message && (
          <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
            {message}
          </div>
        )}

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">
            إضافة شركة جديدة
          </h2>

          <form
            onSubmit={handleCreateCompany}
            className="mt-6 grid gap-5 md:grid-cols-2"
          >
            <div>
              <label className="mb-2 block text-sm font-medium">
                اسم الشركة
              </label>

              <input
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                placeholder="مثال: شركة رنين"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                كود الشركة
              </label>

              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value)
                }
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                placeholder="مثال: RANEEN"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium">
                وصف الشركة
              </label>

              <textarea
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value)
                }
                className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3"
                placeholder="وصف مختصر اختياري"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating
                  ? "جاري إنشاء الشركة..."
                  : "إنشاء الشركة"}
              </button>
            </div>
          </form>
        </section>
{editingCompany && (
  <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold">
      تعديل الشركة
    </h2>

    <p className="mt-2 text-sm text-gray-500">
      {editingCompany.name}
    </p>

    <div className="mt-6 grid gap-5 md:grid-cols-2">
      <div>
        <label className="mb-2 block text-sm font-medium">
          اسم الشركة
        </label>

        <input
          value={editingCompany.name}
          onChange={(event) =>
            setEditingCompany({
              ...editingCompany,
              name: event.target.value,
            })
          }
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          كود الشركة
        </label>

        <input
          value={editingCompany.code}
          disabled
          className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-3"
        />

        <p className="mt-1 text-xs text-gray-500">
          كود الشركة ثابت بعد الإنشاء.
        </p>
      </div>

      <div className="md:col-span-2">
        <label className="mb-2 block text-sm font-medium">
          وصف الشركة
        </label>

        <textarea
          value={editingCompany.description}
          onChange={(event) =>
            setEditingCompany({
              ...editingCompany,
              description: event.target.value,
            })
          }
          className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          لون الشركة
        </label>

        <div className="flex gap-3">
          <input
            type="color"
            value={editingCompany.brandColor || "#000000"}
            onChange={(event) =>
              setEditingCompany({
                ...editingCompany,
                brandColor: event.target.value,
              })
            }
            className="h-12 w-16 cursor-pointer rounded border"
          />

          <input
            value={editingCompany.brandColor}
            onChange={(event) =>
              setEditingCompany({
                ...editingCompany,
                brandColor: event.target.value,
              })
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-3"
            placeholder="#000000"
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          اسم اللون
        </label>

        <input
          value={editingCompany.brandColorName}
          onChange={(event) =>
            setEditingCompany({
              ...editingCompany,
              brandColorName: event.target.value,
            })
          }
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
          placeholder="مثال: أحمر"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          اللغة الافتراضية
        </label>

        <select
          value={editingCompany.defaultLanguage}
          onChange={(event) => {
            const language = event.target.value;

            setEditingCompany({
              ...editingCompany,
              defaultLanguage: language,
              supportedLanguages:
                editingCompany.supportedLanguages.includes(language)
                  ? editingCompany.supportedLanguages
                  : [
                      ...editingCompany.supportedLanguages,
                      language,
                    ],
            });
          }}
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
        >
          <option value="ar">العربية</option>
          <option value="en">الإنجليزية</option>
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          اللغات المدعومة
        </label>

        <div className="flex gap-6 rounded-lg border border-gray-300 px-4 py-3">
          {[
            ["ar", "العربية"],
            ["en", "الإنجليزية"],
          ].map(([value, label]) => (
            <label
              key={value}
              className="flex items-center gap-2"
            >
              <input
                type="checkbox"
                checked={editingCompany.supportedLanguages.includes(
                  value
                )}
                onChange={(event) => {
                  const languages = event.target.checked
                    ? [
                        ...editingCompany.supportedLanguages,
                        value,
                      ]
                    : editingCompany.supportedLanguages.filter(
                        (language) => language !== value
                      );

                  if (
                    languages.length === 0 ||
                    !languages.includes(
                      editingCompany.defaultLanguage
                    )
                  ) {
                    return;
                  }

                  setEditingCompany({
                    ...editingCompany,
                    supportedLanguages: languages,
                  });
                }}
              />

              {label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          البريد الإلكتروني
        </label>

        <input
          type="email"
          value={editingCompany.contactEmail}
          onChange={(event) =>
            setEditingCompany({
              ...editingCompany,
              contactEmail: event.target.value,
            })
          }
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          رقم الهاتف
        </label>

        <input
          value={editingCompany.contactPhone}
          onChange={(event) =>
            setEditingCompany({
              ...editingCompany,
              contactPhone: event.target.value,
            })
          }
          className="w-full rounded-lg border border-gray-300 px-4 py-3"
        />
      </div>

      <div className="flex gap-3 md:col-span-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSaveCompany}
          className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => setEditingCompany(null)}
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
            الشركات
          </h2>

          {loading ? (
            <p className="mt-6 text-gray-500">
              جاري تحميل الشركات...
            </p>
          ) : companies.length === 0 ? (
            <p className="mt-6 text-gray-500">
              لا توجد شركات حتى الآن.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="border-b text-sm text-gray-500">
                    <th className="px-3 py-3">
                      الشركة
                    </th>
                    <th className="px-3 py-3">
                      الكود
                    </th>
                    <th className="px-3 py-3">
                      اللغة
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
                  {companies.map((company) => (
                    <tr
                      key={company.id}
                      className="border-b"
                    >
                      <td className="px-3 py-4">
                        <div className="font-medium">
                          {company.name}
                        </div>

                        {company.description && (
                          <div className="mt-1 text-xs text-gray-500">
                            {company.description}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-4">
                        {company.code}
                      </td>

                      <td className="px-3 py-4">
                        {company.defaultLanguage === "ar"
                          ? "العربية"
                          : company.defaultLanguage}
                      </td>

                      <td className="px-3 py-4">
                        {company.active
                          ? "نشطة"
                          : "غير نشطة"}
                      </td>
                    <td className="px-3 py-4">
  <div className="flex gap-2">
    <button
      type="button"
      onClick={() => {
        setEditingCompany(company);
        setMessage("");
      }}
      className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
    >
      تعديل
    </button>

    <button
      type="button"
      onClick={() => toggleCompanyActive(company)}
      className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
    >
      {company.active ? "تعطيل" : "تفعيل"}
    </button>

    <Link
      href={`/dashboard/company-users?companyId=${encodeURIComponent(company.id)}`}
      className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
    >
      مستخدمو الشركة
    </Link>
  </div>
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
