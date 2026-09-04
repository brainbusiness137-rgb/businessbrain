import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { getCurrentPlatformUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import {
  parsePersistedOrganizationUnit,
  parsePersistedOrganizationUnitMembership,
} from "@/lib/organization-units";
import {
  hasPlatformAuthority,
  PERMISSIONS,
} from "@/lib/permissions";
import {
  hasOnlyAllowedFields,
  isValidFirestoreDocumentId,
  readJsonObject,
} from "@/lib/request-validation";
import { parsePersistedCompanyUser } from "@/lib/tenant-auth";
import {
  organizationUnitMembershipDocumentId,
  platformActorPath,
} from "@/lib/tenant-model";

class UnitMembershipError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 409
  ) {
    super(message);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof UnitMembershipError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: error.status }
    );
  }

  console.error("Organization unit membership operation failed:", error);
  return NextResponse.json(
    { success: false, message: "Organization unit membership operation failed." },
    { status: 500 }
  );
}

async function requireMembershipActor() {
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

function validRelationshipRequest(body: Record<string, unknown>): boolean {
  return (
    typeof body.companyId === "string" &&
    isValidFirestoreDocumentId(body.companyId) &&
    typeof body.organizationUnitId === "string" &&
    isValidFirestoreDocumentId(body.organizationUnitId) &&
    typeof body.userId === "string" &&
    isValidFirestoreDocumentId(body.userId) &&
    typeof body.active === "boolean"
  );
}

async function validateActiveReferences(
  transaction: FirebaseFirestore.Transaction,
  companyId: string,
  organizationUnitId: string,
  userId: string
) {
  const companySnapshot = await transaction.get(
    adminDb.collection("companies").doc(companyId)
  );
  const unitSnapshot = await transaction.get(
    adminDb.collection("organizationUnits").doc(organizationUnitId)
  );
  const userSnapshot = await transaction.get(
    adminDb.collection("users").doc(userId)
  );
  const unit = unitSnapshot.exists
    ? parsePersistedOrganizationUnit(unitSnapshot.id, unitSnapshot.data())
    : null;
  const user = userSnapshot.exists
    ? parsePersistedCompanyUser(userSnapshot.id, userSnapshot.data())
    : null;

  if (!companySnapshot.exists || !unit || !user) {
    throw new UnitMembershipError(
      "Company, organization unit, or company user is missing or invalid.",
      404
    );
  }

  if (
    companySnapshot.data()?.active !== true ||
    unit.companyId !== companyId ||
    !unit.active ||
    user.companyId !== companyId ||
    !user.active
  ) {
    throw new UnitMembershipError(
      "Active membership requires an active same-company unit and user.",
      409
    );
  }
}

export async function GET(request: Request) {
  try {
    const actorResult = await requireMembershipActor();
    if ("error" in actorResult) return actorResult.error;

    const searchParams = new URL(request.url).searchParams;

    if (
      !hasExactQuery(searchParams, ["companyId", "organizationUnitId"])
    ) {
      return NextResponse.json(
        { success: false, message: "Unexpected unit membership query." },
        { status: 400 }
      );
    }

    const companyId = searchParams.get("companyId");
    const organizationUnitId = searchParams.get("organizationUnitId");

    if (
      !companyId ||
      !isValidFirestoreDocumentId(companyId) ||
      !organizationUnitId ||
      !isValidFirestoreDocumentId(organizationUnitId)
    ) {
      return NextResponse.json(
        { success: false, message: "A valid company and unit are required." },
        { status: 400 }
      );
    }

    const [companySnapshot, unitSnapshot] = await Promise.all([
      adminDb.collection("companies").doc(companyId).get(),
      adminDb
        .collection("organizationUnits")
        .doc(organizationUnitId)
        .get(),
    ]);
    const unit = unitSnapshot.exists
      ? parsePersistedOrganizationUnit(unitSnapshot.id, unitSnapshot.data())
      : null;

    if (!companySnapshot.exists || !unit || unit.companyId !== companyId) {
      return NextResponse.json(
        { success: false, message: "Company or organization unit not found." },
        { status: 404 }
      );
    }

    const snapshot = await adminDb
      .collection("organizationUnitMembers")
      .where("companyId", "==", companyId)
      .where("organizationUnitId", "==", organizationUnitId)
      .get();
    const candidates = snapshot.docs.flatMap((document) => {
      const membership = parsePersistedOrganizationUnitMembership(
        document.id,
        document.data()
      );
      return membership &&
        membership.companyId === companyId &&
        membership.organizationUnitId === organizationUnitId
        ? [membership]
        : [];
    });
    const userIds = [...new Set(candidates.map(({ userId }) => userId))];
    const userSnapshots = userIds.length
      ? await adminDb.getAll(
          ...userIds.map((userId) => adminDb.collection("users").doc(userId))
        )
      : [];
    const validUserIds = new Set(
      userSnapshots.flatMap((userSnapshot) => {
        const user = userSnapshot.exists
          ? parsePersistedCompanyUser(userSnapshot.id, userSnapshot.data())
          : null;
        return user && user.companyId === companyId ? [user.id] : [];
      })
    );
    const memberships = candidates
      .filter(({ userId }) => validUserIds.has(userId))
      .map(({ companyId: scopedCompanyId, organizationUnitId: unitId, userId, active }) => ({
        companyId: scopedCompanyId,
        organizationUnitId: unitId,
        userId,
        active,
      }));

    return NextResponse.json({ success: true, memberships });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actorResult = await requireMembershipActor();
    if ("error" in actorResult) return actorResult.error;

    const body = await readJsonObject(request);

    if (
      !body ||
      !hasOnlyAllowedFields(body, [
        "companyId",
        "organizationUnitId",
        "userId",
        "active",
      ]) ||
      !validRelationshipRequest(body)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid unit membership request." },
        { status: 400 }
      );
    }

    const companyId = body.companyId as string;
    const organizationUnitId = body.organizationUnitId as string;
    const userId = body.userId as string;
    const active = body.active as boolean;
    const membershipId = organizationUnitMembershipDocumentId(
      organizationUnitId,
      userId
    );

    if (!membershipId) {
      return NextResponse.json(
        { success: false, message: "Unit membership identity is invalid." },
        { status: 400 }
      );
    }

    const membershipRef = adminDb
      .collection("organizationUnitMembers")
      .doc(membershipId);

    await adminDb.runTransaction(async (transaction) => {
      await validateActiveReferences(
        transaction,
        companyId,
        organizationUnitId,
        userId
      );
      const membershipSnapshot = await transaction.get(membershipRef);

      if (membershipSnapshot.exists) {
        throw new UnitMembershipError(
          "Unit membership already exists; use PATCH to manage it.",
          409
        );
      }

      transaction.create(membershipRef, {
        companyId,
        organizationUnitId,
        userId,
        active,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: platformActorPath(actorResult.actor.id),
      });
    });

    return NextResponse.json(
      {
        success: true,
        membership: { companyId, organizationUnitId, userId, active },
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actorResult = await requireMembershipActor();
    if ("error" in actorResult) return actorResult.error;

    const body = await readJsonObject(request);

    if (
      !body ||
      !hasOnlyAllowedFields(body, [
        "companyId",
        "organizationUnitId",
        "userId",
        "active",
      ]) ||
      !validRelationshipRequest(body)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid unit membership request." },
        { status: 400 }
      );
    }

    const companyId = body.companyId as string;
    const organizationUnitId = body.organizationUnitId as string;
    const userId = body.userId as string;
    const active = body.active as boolean;
    const membershipId = organizationUnitMembershipDocumentId(
      organizationUnitId,
      userId
    );

    if (!membershipId) {
      return NextResponse.json(
        { success: false, message: "Unit membership identity is invalid." },
        { status: 400 }
      );
    }

    const membershipRef = adminDb
      .collection("organizationUnitMembers")
      .doc(membershipId);

    await adminDb.runTransaction(async (transaction) => {
      if (active) {
        await validateActiveReferences(
          transaction,
          companyId,
          organizationUnitId,
          userId
        );
      }

      const membershipSnapshot = await transaction.get(membershipRef);

      if (!membershipSnapshot.exists) {
        throw new UnitMembershipError("Unit membership not found.", 404);
      }

      const membership = membershipSnapshot.data();

      if (
        membership?.companyId !== companyId ||
        membership.organizationUnitId !== organizationUnitId ||
        membership.userId !== userId
      ) {
        throw new UnitMembershipError(
          "Unit membership relationships do not match.",
          409
        );
      }

      transaction.update(membershipRef, {
        active,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
