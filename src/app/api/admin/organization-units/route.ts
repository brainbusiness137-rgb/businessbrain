import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { getCurrentPlatformUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import {
  filterValidOrganizationHierarchy,
  parsePersistedOrganizationUnit,
} from "@/lib/organization-units";
import {
  hasPlatformAuthority,
  PERMISSIONS,
} from "@/lib/permissions";
import {
  hasOnlyAllowedFields,
  isValidFirestoreDocumentId,
  isValidRequiredString,
  readJsonObject,
} from "@/lib/request-validation";
import { platformActorPath } from "@/lib/tenant-model";

class OrganizationUnitError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409
  ) {
    super(message);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof OrganizationUnitError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: error.status }
    );
  }

  console.error("Organization unit operation failed:", error);
  return NextResponse.json(
    { success: false, message: "Organization unit operation failed." },
    { status: 500 }
  );
}

async function requireOrganizationActor() {
  const actor = await getCurrentPlatformUser();

  if (!actor) {
    return {
      error: NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      ),
    } as const;
  }

  if (!hasPlatformAuthority(actor, PERMISSIONS.manageCompanies)) {
    return {
      error: NextResponse.json(
        { success: false, message: "Company administration is required." },
        { status: 403 }
      ),
    } as const;
  }

  return { actor } as const;
}

function hasExactQuery(
  searchParams: URLSearchParams,
  names: string[]
): boolean {
  const allowed = new Set(names);
  return (
    [...searchParams.keys()].every((name) => allowed.has(name)) &&
    names.every((name) => searchParams.getAll(name).length === 1)
  );
}

async function validateParentChain(
  transaction: FirebaseFirestore.Transaction,
  unitId: string,
  companyId: string,
  parentId: string | null,
  requireActive: boolean
) {
  const visited = new Set([unitId]);
  let currentId = parentId;

  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new OrganizationUnitError(
        "Organization unit hierarchy cycle detected.",
        409
      );
    }

    visited.add(currentId);
    const snapshot = await transaction.get(
      adminDb.collection("organizationUnits").doc(currentId)
    );
    const unit = snapshot.exists
      ? parsePersistedOrganizationUnit(snapshot.id, snapshot.data())
      : null;

    if (!unit) {
      throw new OrganizationUnitError(
        "Parent organization unit is missing or invalid.",
        409
      );
    }

    if (unit.companyId !== companyId) {
      throw new OrganizationUnitError(
        "Parent organization unit belongs to another company.",
        409
      );
    }

    if (requireActive && !unit.active) {
      throw new OrganizationUnitError(
        "Parent organization unit is inactive.",
        409
      );
    }

    currentId = unit.parentId;
  }
}

export async function GET(request: Request) {
  try {
    const actorResult = await requireOrganizationActor();
    if ("error" in actorResult) return actorResult.error;

    const searchParams = new URL(request.url).searchParams;

    if (!hasExactQuery(searchParams, ["companyId"])) {
      return NextResponse.json(
        { success: false, message: "Unexpected organization unit query." },
        { status: 400 }
      );
    }

    const companyId = searchParams.get("companyId");

    if (!companyId || !isValidFirestoreDocumentId(companyId)) {
      return NextResponse.json(
        { success: false, message: "A valid company is required." },
        { status: 400 }
      );
    }

    const companySnapshot = await adminDb
      .collection("companies")
      .doc(companyId)
      .get();

    if (!companySnapshot.exists) {
      return NextResponse.json(
        { success: false, message: "Company not found." },
        { status: 404 }
      );
    }

    const snapshot = await adminDb
      .collection("organizationUnits")
      .where("companyId", "==", companyId)
      .get();
    const parsedUnits = snapshot.docs.flatMap((document) => {
      const unit = parsePersistedOrganizationUnit(
        document.id,
        document.data()
      );
      return unit ? [unit] : [];
    });
    const units = filterValidOrganizationHierarchy(
      parsedUnits,
      companyId
    ).sort((left, right) => left.name.localeCompare(right.name, "ar"));

    return NextResponse.json({ success: true, units });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actorResult = await requireOrganizationActor();
    if ("error" in actorResult) return actorResult.error;

    const body = await readJsonObject(request);

    if (
      !body ||
      !hasOnlyAllowedFields(body, ["companyId", "name", "parentId", "active"]) ||
      typeof body.companyId !== "string" ||
      !isValidFirestoreDocumentId(body.companyId) ||
      !isValidRequiredString(body.name, 200) ||
      (body.parentId !== null &&
        (typeof body.parentId !== "string" ||
          !isValidFirestoreDocumentId(body.parentId))) ||
      typeof body.active !== "boolean"
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid organization unit request." },
        { status: 400 }
      );
    }

    const companyId = body.companyId;
    const name = body.name.trim();
    const parentId = body.parentId as string | null;
    const active = body.active;
    const unitRef = adminDb.collection("organizationUnits").doc();

    await adminDb.runTransaction(async (transaction) => {
      const companySnapshot = await transaction.get(
        adminDb.collection("companies").doc(companyId)
      );

      if (!companySnapshot.exists) {
        throw new OrganizationUnitError("Company not found.", 404);
      }

      if (companySnapshot.data()?.active !== true) {
        throw new OrganizationUnitError("Company is inactive.", 409);
      }

      await validateParentChain(
        transaction,
        unitRef.id,
        companyId,
        parentId,
        true
      );

      transaction.create(unitRef, {
        companyId,
        name,
        parentId,
        active,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: platformActorPath(actorResult.actor.id),
      });
    });

    return NextResponse.json(
      {
        success: true,
        unit: {
          id: unitRef.id,
          companyId,
          name,
          parentId,
          active,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actorResult = await requireOrganizationActor();
    if ("error" in actorResult) return actorResult.error;

    const body = await readJsonObject(request);

    if (
      !body ||
      !hasOnlyAllowedFields(body, ["organizationUnitId", "name", "parentId", "active"]) ||
      typeof body.organizationUnitId !== "string" ||
      !isValidFirestoreDocumentId(body.organizationUnitId) ||
      (body.name === undefined &&
        body.parentId === undefined &&
        body.active === undefined) ||
      (body.name !== undefined && !isValidRequiredString(body.name, 200)) ||
      (body.parentId !== undefined &&
        body.parentId !== null &&
        (typeof body.parentId !== "string" ||
          !isValidFirestoreDocumentId(body.parentId))) ||
      (body.active !== undefined && typeof body.active !== "boolean")
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid organization unit request." },
        { status: 400 }
      );
    }

    const unitId = body.organizationUnitId;
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const unitRef = adminDb.collection("organizationUnits").doc(unitId);

    await adminDb.runTransaction(async (transaction) => {
      const unitSnapshot = await transaction.get(unitRef);
      const unit = unitSnapshot.exists
        ? parsePersistedOrganizationUnit(unitSnapshot.id, unitSnapshot.data())
        : null;

      if (!unit) {
        throw new OrganizationUnitError(
          "Organization unit not found or invalid.",
          404
        );
      }

      const companySnapshot = await transaction.get(
        adminDb.collection("companies").doc(unit.companyId)
      );

      if (!companySnapshot.exists) {
        throw new OrganizationUnitError("Company not found.", 404);
      }

      const nextParentId =
        body.parentId === undefined
          ? unit.parentId
          : (body.parentId as string | null);
      const nextActive =
        typeof body.active === "boolean" ? body.active : unit.active;

      if (nextActive && companySnapshot.data()?.active !== true) {
        throw new OrganizationUnitError("Company is inactive.", 409);
      }

      if (body.parentId !== undefined || nextActive) {
        await validateParentChain(
          transaction,
          unit.id,
          unit.companyId,
          nextParentId,
          nextActive
        );
      }

      const updates: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (name !== undefined) updates.name = name;
      if (body.parentId !== undefined) updates.parentId = body.parentId;
      if (typeof body.active === "boolean") updates.active = body.active;

      transaction.update(unitRef, updates);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
