import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getCurrentPlatformUser } from "@/lib/auth";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  isCompanyRole,
  isUserLanguage,
} from "@/lib/company-roles";
import {
  hasPlatformAuthority,
  PERMISSIONS,
} from "@/lib/permissions";
import {
  hasOnlyAllowedFields,
  isValidEmail,
  isValidFirebaseUid,
  isValidFirestoreDocumentId,
  isValidRequiredString,
  readJsonObject,
} from "@/lib/request-validation";
import {
  companyUserDocumentId,
  platformActorPath,
} from "@/lib/tenant-model";
import { parsePersistedCompanyUser } from "@/lib/tenant-auth";

class ProvisioningError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409
  ) {
    super(message);
  }
}

function provisioningError(error: unknown) {
  if (error instanceof ProvisioningError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: error.status }
    );
  }

  console.error("Company user provisioning failed:", error);
  return NextResponse.json(
    { success: false, message: "Company user provisioning failed." },
    { status: 500 }
  );
}

export async function GET(request: Request) {
  try {
    const actor = await getCurrentPlatformUser();

    if (!actor) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!hasPlatformAuthority(actor, PERMISSIONS.manageCompanies)) {
      return NextResponse.json(
        { success: false, message: "Company administration is required." },
        { status: 403 }
      );
    }

    const companyId = new URL(request.url).searchParams.get("companyId");

    if (!companyId || !isValidFirestoreDocumentId(companyId)) {
      return NextResponse.json(
        { success: false, message: "A valid company is required." },
        { status: 400 }
      );
    }

    const snapshot = await adminDb
      .collection("users")
      .where("companyId", "==", companyId)
      .get();

    const users = snapshot.docs
      .map((document) =>
        parsePersistedCompanyUser(document.id, document.data())
      )
      .filter((user) => user !== null)
      .map(({ id, companyId, name, email, role, active, language }) => ({
        id,
        companyId,
        name,
        email,
        role,
        active,
        language,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "ar"));

    return NextResponse.json({ success: true, users });
  } catch (error) {
    console.error("Company user listing failed:", error);
    return NextResponse.json(
      { success: false, message: "Company user listing failed." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getCurrentPlatformUser();

    if (!actor) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!hasPlatformAuthority(actor, PERMISSIONS.manageCompanies)) {
      return NextResponse.json(
        { success: false, message: "Company administration is required." },
        { status: 403 }
      );
    }

    const body = await readJsonObject(request);

    if (
      !body ||
      !hasOnlyAllowedFields(body, [
        "authUid",
        "companyId",
        "name",
        "email",
        "role",
        "active",
        "language",
      ]) ||
      !isValidFirebaseUid(body.authUid) ||
      typeof body.companyId !== "string" ||
      !isValidFirestoreDocumentId(body.companyId) ||
      !isValidRequiredString(body.name, 200) ||
      typeof body.email !== "string" ||
      !isValidEmail(body.email.trim().toLowerCase()) ||
      !isCompanyRole(body.role) ||
      typeof body.active !== "boolean" ||
      !isUserLanguage(body.language)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid company user request." },
        { status: 400 }
      );
    }

    const authUid = body.authUid;
    const companyId = body.companyId;
    const name = body.name.trim();
    const email = body.email.trim().toLowerCase();
    const role = body.role;
    const active = body.active;
    const language = body.language;
    const firebaseUser = await adminAuth.getUser(authUid);

    if (
      !firebaseUser.email ||
      firebaseUser.email.toLowerCase() !== email
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Email must match the Firebase Authentication identity.",
        },
        { status: 409 }
      );
    }

    const existingIdentity = await adminDb
      .collection("users")
      .where("authUid", "==", authUid)
      .limit(1)
      .get();

    if (!existingIdentity.empty) {
      return NextResponse.json(
        { success: false, message: "Company user identity already exists." },
        { status: 409 }
      );
    }

    const userId = companyUserDocumentId(authUid);
    const userRef = adminDb.collection("users").doc(userId);
    const companyRef = adminDb.collection("companies").doc(companyId);
    const actorPath = platformActorPath(actor.id);

    await adminDb.runTransaction(async (transaction) => {
      const companySnapshot = await transaction.get(companyRef);
      const userSnapshot = await transaction.get(userRef);

      if (!companySnapshot.exists) {
        throw new ProvisioningError("Company not found.", 404);
      }

      if (companySnapshot.data()?.active !== true) {
        throw new ProvisioningError("Company is inactive.", 409);
      }

      if (userSnapshot.exists) {
        throw new ProvisioningError(
          "Company user identity already exists.",
          409
        );
      }

      transaction.create(userRef, {
        authUid,
        companyId,
        name,
        email,
        role,
        active,
        language,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: actorPath,
      });
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: userId,
          authUid,
          companyId,
          name,
          email,
          role,
          active,
          language,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return provisioningError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getCurrentPlatformUser();

    if (!actor) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!hasPlatformAuthority(actor, PERMISSIONS.manageCompanies)) {
      return NextResponse.json(
        { success: false, message: "Company administration is required." },
        { status: 403 }
      );
    }

    const body = await readJsonObject(request);

    if (
      !body ||
      !hasOnlyAllowedFields(body, [
        "userId",
        "name",
        "role",
        "active",
        "language",
      ]) ||
      typeof body.userId !== "string" ||
      !isValidFirestoreDocumentId(body.userId) ||
      (body.name === undefined &&
        body.role === undefined &&
        body.active === undefined &&
        body.language === undefined) ||
      (body.name !== undefined &&
        !isValidRequiredString(body.name, 200)) ||
      (body.role !== undefined && !isCompanyRole(body.role)) ||
      (body.active !== undefined && typeof body.active !== "boolean") ||
      (body.language !== undefined && !isUserLanguage(body.language))
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid company user request." },
        { status: 400 }
      );
    }

    const userRef = adminDb.collection("users").doc(body.userId);
    const updatedName =
      typeof body.name === "string" ? body.name.trim() : undefined;
    const updatedRole = body.role;
    const updatedActive = body.active;
    const updatedLanguage = body.language;

    await adminDb.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);

      if (!userSnapshot.exists) {
        throw new ProvisioningError("Company user not found.", 404);
      }

      const companyId = userSnapshot.data()?.companyId;

      if (!isValidFirestoreDocumentId(companyId)) {
        throw new ProvisioningError("Company user data is invalid.", 409);
      }

      const companySnapshot = await transaction.get(
        adminDb.collection("companies").doc(companyId)
      );

      if (!companySnapshot.exists) {
        throw new ProvisioningError("Company not found.", 404);
      }

      const updates: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (updatedName !== undefined) updates.name = updatedName;
      if (updatedRole !== undefined) updates.role = updatedRole;
      if (updatedActive !== undefined) updates.active = updatedActive;
      if (updatedLanguage !== undefined) updates.language = updatedLanguage;

      transaction.update(userRef, updates);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return provisioningError(error);
  }
}
