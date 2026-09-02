import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getCurrentPlatformUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentPlatformUser();

    if (!currentUser) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    if (currentUser.permissions?.manageProjects !== true) {
      return NextResponse.json(
        {
          success: false,
          message: "ليس لديك صلاحية لإدارة المشاريع.",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    let query: FirebaseFirestore.Query = adminDb.collection(
      "projects"
    );

    if (companyId) {
      query = query.where("companyId", "==", companyId);
    }

    const snapshot = await query.get();

    const projects = snapshot.docs
      .map((doc) => {
        const data = doc.data();

        return {
          id: doc.id,
          companyId: data.companyId ?? "",
          name: data.name ?? "",
          code: data.code ?? "",
          description: data.description ?? "",
          status: data.status ?? "active",
         startDate: data.startDate?.toDate
  ? data.startDate.toDate().toISOString().split("T")[0]
  : typeof data.startDate === "string"
    ? data.startDate
    : null,

endDate: data.endDate?.toDate
  ? data.endDate.toDate().toISOString().split("T")[0]
  : typeof data.endDate === "string"
    ? data.endDate
    : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      success: true,
      projects,
    });
  } catch (error) {
    console.error("GET projects failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "حدث خطأ أثناء تحميل المشاريع.",
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
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    if (currentUser.permissions?.manageProjects !== true) {
      return NextResponse.json(
        {
          success: false,
          message: "ليس لديك صلاحية لإدارة المشاريع.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    const companyId =
      typeof body.companyId === "string"
        ? body.companyId.trim()
        : "";

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const code =
      typeof body.code === "string"
        ? body.code.trim().toUpperCase()
        : "";

    if (!companyId) {
      return NextResponse.json(
        {
          success: false,
          message: "الشركة مطلوبة.",
        },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          message: "اسم المشروع مطلوب.",
        },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        {
          success: false,
          message: "كود المشروع مطلوب.",
        },
        { status: 400 }
      );
    }

    const companySnapshot = await adminDb
      .collection("companies")
      .doc(companyId)
      .get();

    if (!companySnapshot.exists) {
      return NextResponse.json(
        {
          success: false,
          message: "الشركة غير موجودة.",
        },
        { status: 404 }
      );
    }

    const companyData = companySnapshot.data();

    if (companyData?.active !== true) {
      return NextResponse.json(
        {
          success: false,
          message: "لا يمكن إنشاء مشروع لشركة غير نشطة.",
        },
        { status: 400 }
      );
    }

    const duplicateSnapshot = await adminDb
      .collection("projects")
      .where("companyId", "==", companyId)
      .where("code", "==", code)
      .limit(1)
      .get();

    if (!duplicateSnapshot.empty) {
      return NextResponse.json(
        {
          success: false,
          message:
            "يوجد مشروع بنفس الكود داخل هذه الشركة.",
        },
        { status: 409 }
      );
    }

    const projectData = {
      companyId,
      name,
      code,
      description:
        typeof body.description === "string"
          ? body.description.trim()
          : "",
     startDate:
  typeof body.startDate === "string" && body.startDate
    ? new Date(`${body.startDate}T00:00:00`)
    : null,

endDate:
  typeof body.endDate === "string" && body.endDate
    ? new Date(`${body.endDate}T00:00:00`)
    : null,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: currentUser.authUid,
    };

    const projectRef = await adminDb
      .collection("projects")
      .add(projectData);

    return NextResponse.json(
      {
        success: true,
        project: {
          id: projectRef.id,
          ...projectData,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST project failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "حدث خطأ أثناء إنشاء المشروع.",
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
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    if (currentUser.permissions?.manageProjects !== true) {
      return NextResponse.json(
        {
          success: false,
          message: "ليس لديك صلاحية لإدارة المشاريع.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    const projectId =
      typeof body.projectId === "string"
        ? body.projectId.trim()
        : "";

    if (!projectId) {
      return NextResponse.json(
        {
          success: false,
          message: "معرف المشروع مطلوب.",
        },
        { status: 400 }
      );
    }

    const projectRef = adminDb
      .collection("projects")
      .doc(projectId);

    const projectSnapshot = await projectRef.get();

    if (!projectSnapshot.exists) {
      return NextResponse.json(
        {
          success: false,
          message: "المشروع غير موجود.",
        },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (body.name !== undefined) {
      if (
        typeof body.name !== "string" ||
        !body.name.trim()
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "اسم المشروع مطلوب.",
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

    if (body.startDate !== undefined) {
      updates.startDate =
        typeof body.startDate === "string" &&
        body.startDate
          ? new Date(`${body.startDate}T00:00:00`)
          : null;
    }

    if (body.endDate !== undefined) {
      updates.endDate =
        typeof body.endDate === "string" &&
        body.endDate
          ? new Date(`${body.endDate}T00:00:00`)
          : null;
    }

    if (body.status !== undefined) {
      if (
        body.status !== "active" &&
        body.status !== "inactive" &&
        body.status !== "completed"
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "حالة المشروع غير صحيحة.",
          },
          { status: 400 }
        );
      }

      updates.status = body.status;
    }

    await projectRef.update(updates);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("PATCH project failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "حدث خطأ أثناء تحديث المشروع.",
      },
      { status: 500 }
    );
  }
}