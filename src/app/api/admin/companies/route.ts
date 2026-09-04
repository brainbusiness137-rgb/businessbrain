import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getCurrentPlatformUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import {
  hasPlatformAuthority,
  PERMISSIONS,
} from "@/lib/permissions";

export async function GET() {
  try {
    const currentUser = await getCurrentPlatformUser();

    if (!currentUser) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    if (
      !hasPlatformAuthority(
        currentUser,
        PERMISSIONS.manageCompanies
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "ليس لديك صلاحية لإدارة الشركات.",
        },
        { status: 403 }
      );
    }

    const snapshot = await adminDb
      .collection("companies")
      .orderBy("createdAt", "desc")
      .get();

    const companies = snapshot.docs.map((doc) => {
      const data = doc.data();

      return {
        id: doc.id,
        name: data.name ?? "",
        code: data.code ?? "",
        description: data.description ?? "",
        logoUrl: data.logoUrl ?? "",
        brandColor: data.brandColor ?? "",
        brandColorName: data.brandColorName ?? "",
        brandTheme: data.brandTheme ?? {},
        defaultLanguage: data.defaultLanguage ?? "ar",
        supportedLanguages: data.supportedLanguages ?? ["ar"],
        contactEmail: data.contactEmail ?? "",
        contactPhone: data.contactPhone ?? "",
        active: data.active === true,
      };
    });

    return NextResponse.json({
      success: true,
      companies,
    });
  } catch (error) {
    console.error("GET companies failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "حدث خطأ أثناء تحميل الشركات.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentPlatformUser();

    if (!currentUser) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    if (
      !hasPlatformAuthority(
        currentUser,
        PERMISSIONS.manageCompanies
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "ليس لديك صلاحية لإدارة الشركات.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    const code =
      typeof body.code === "string"
        ? body.code.trim().toUpperCase()
        : "";

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          message: "اسم الشركة مطلوب.",
        },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        {
          success: false,
          message: "كود الشركة مطلوب.",
        },
        { status: 400 }
      );
    }

    const existingCompany = await adminDb
      .collection("companies")
      .where("code", "==", code)
      .limit(1)
      .get();

    if (!existingCompany.empty) {
      return NextResponse.json(
        {
          success: false,
          message: "كود الشركة مستخدم بالفعل.",
        },
        { status: 409 }
      );
    }

    const companyData = {
      name,
      code,

      description:
        typeof body.description === "string"
          ? body.description.trim()
          : "",

      logoUrl: "",

      brandColor: "#000000",
      brandColorName: "أسود",
      brandTheme: {
        primary: "#000000",
      },

      defaultLanguage: "ar",
      supportedLanguages: ["ar"],

      contactEmail: "",
      contactPhone: "",

      active: true,

      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),

      createdBy: currentUser.authUid,
    };

    const companyRef = await adminDb
      .collection("companies")
      .add(companyData);

    return NextResponse.json(
      {
        success: true,
        company: {
          id: companyRef.id,
          ...companyData,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST company failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "حدث خطأ أثناء إنشاء الشركة.",
      },
      { status: 500 }
    );
  }
}
export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentPlatformUser();

    if (!currentUser) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    if (
      !hasPlatformAuthority(
        currentUser,
        PERMISSIONS.manageCompanies
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "ليس لديك صلاحية لإدارة الشركات.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    if (
      typeof body.companyId !== "string" ||
      !body.companyId.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "معرف الشركة مطلوب.",
        },
        { status: 400 }
      );
    }

    const companyRef = adminDb
      .collection("companies")
      .doc(body.companyId);

    const companySnapshot = await companyRef.get();

    if (!companySnapshot.exists) {
      return NextResponse.json(
        {
          success: false,
          message: "الشركة غير موجودة.",
        },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return NextResponse.json(
          {
            success: false,
            message: "حالة الشركة غير صحيحة.",
          },
          { status: 400 }
        );
      }

      updates.active = body.active;
    }

    if (body.name !== undefined) {
      if (
        typeof body.name !== "string" ||
        !body.name.trim()
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "اسم الشركة مطلوب.",
          },
          { status: 400 }
        );
      }

      updates.name = body.name.trim();
    }

    if (body.description !== undefined) {
      updates.description =
        typeof body.description === "string"
          ? body.description.trim()
          : "";
    }

    if (body.brandColor !== undefined) {
      if (typeof body.brandColor !== "string") {
        return NextResponse.json(
          {
            success: false,
            message: "لون الشركة غير صحيح.",
          },
          { status: 400 }
        );
      }

      updates.brandColor = body.brandColor;
      updates.brandTheme = {
        primary: body.brandColor,
      };
    }

    if (body.brandColorName !== undefined) {
      updates.brandColorName =
        typeof body.brandColorName === "string"
          ? body.brandColorName.trim()
          : "";
    }

    if (body.defaultLanguage !== undefined) {
      if (
        body.defaultLanguage !== "ar" &&
        body.defaultLanguage !== "en"
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "اللغة الافتراضية غير صحيحة.",
          },
          { status: 400 }
        );
      }

      updates.defaultLanguage = body.defaultLanguage;
    }

    if (body.supportedLanguages !== undefined) {
      if (
        !Array.isArray(body.supportedLanguages) ||
        body.supportedLanguages.length === 0 ||
        !body.supportedLanguages.every(
          (language: unknown) =>
            language === "ar" || language === "en"
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "اللغات المدعومة غير صحيحة.",
          },
          { status: 400 }
        );
      }

      updates.supportedLanguages =
        body.supportedLanguages;
    }

    if (body.contactEmail !== undefined) {
      updates.contactEmail =
        typeof body.contactEmail === "string"
          ? body.contactEmail.trim()
          : "";
    }

    if (body.contactPhone !== undefined) {
      updates.contactPhone =
        typeof body.contactPhone === "string"
          ? body.contactPhone.trim()
          : "";
    }

    await companyRef.update(updates);

    const updatedSnapshot = await companyRef.get();
    const updatedCompany = updatedSnapshot.data();

    return NextResponse.json({
      success: true,
      company: {
        id: updatedSnapshot.id,
        name: updatedCompany?.name ?? "",
        code: updatedCompany?.code ?? "",
        description: updatedCompany?.description ?? "",
        logoUrl: updatedCompany?.logoUrl ?? "",
        brandColor: updatedCompany?.brandColor ?? "",
        brandColorName:
          updatedCompany?.brandColorName ?? "",
        brandTheme: updatedCompany?.brandTheme ?? {},
        defaultLanguage:
          updatedCompany?.defaultLanguage ?? "ar",
        supportedLanguages:
          updatedCompany?.supportedLanguages ?? ["ar"],
        contactEmail:
          updatedCompany?.contactEmail ?? "",
        contactPhone:
          updatedCompany?.contactPhone ?? "",
        active: updatedCompany?.active === true,
      },
    });
  } catch (error) {
    console.error("PATCH company failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "حدث خطأ أثناء تحديث الشركة.",
      },
      { status: 500 }
    );
  }
}
