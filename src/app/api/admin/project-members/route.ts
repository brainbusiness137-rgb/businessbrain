import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getCurrentPlatformUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import {
  hasPlatformAuthority,
  PERMISSIONS,
} from "@/lib/permissions";
import {
  hasOnlyAllowedFields,
  isValidFirestoreDocumentId,
  readJsonObject,
} from "@/lib/request-validation";
import {
  platformActorPath,
  projectMembershipDocumentId,
} from "@/lib/tenant-model";
import { parsePersistedCompanyUser } from "@/lib/tenant-auth";

class MembershipProvisioningError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 409
  ) {
    super(message);
  }
}

function membershipError(error: unknown) {
  if (error instanceof MembershipProvisioningError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: error.status }
    );
  }

  console.error("Project membership provisioning failed:", error);
  return NextResponse.json(
    { success: false, message: "Project membership provisioning failed." },
    { status: 500 }
  );
}

async function requireProjectProvisioningActor() {
  const actor = await getCurrentPlatformUser();

  if (!actor) {
    return {
      error: NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      ),
    } as const;
  }

  if (!hasPlatformAuthority(actor, PERMISSIONS.manageProjects)) {
    return {
      error: NextResponse.json(
        { success: false, message: "Project administration is required." },
        { status: 403 }
      ),
    } as const;
  }

  return { actor } as const;
}

function validMembershipRequest(body: Record<string, unknown>): boolean {
  return (
    typeof body.companyId === "string" &&
    isValidFirestoreDocumentId(body.companyId) &&
    typeof body.projectId === "string" &&
    isValidFirestoreDocumentId(body.projectId) &&
    typeof body.userId === "string" &&
    isValidFirestoreDocumentId(body.userId) &&
    typeof body.active === "boolean"
  );
}

export async function GET(request: Request) {
  try {
    const actorResult = await requireProjectProvisioningActor();

    if ("error" in actorResult) return actorResult.error;

    const searchParams = new URL(request.url).searchParams;
    const allowedQueryParameters = new Set(["companyId", "userId"]);

    if (
      [...searchParams.keys()].some(
        (parameter) => !allowedQueryParameters.has(parameter)
      ) ||
      searchParams.getAll("companyId").length !== 1 ||
      searchParams.getAll("userId").length !== 1
    ) {
      return NextResponse.json(
        { success: false, message: "Unexpected project membership query." },
        { status: 400 }
      );
    }

    const companyId = searchParams.get("companyId");
    const userId = searchParams.get("userId");

    if (
      !companyId ||
      !isValidFirestoreDocumentId(companyId) ||
      !userId ||
      !isValidFirestoreDocumentId(userId)
    ) {
      return NextResponse.json(
        { success: false, message: "A valid company and user are required." },
        { status: 400 }
      );
    }

    const userSnapshot = await adminDb.collection("users").doc(userId).get();
    const companyUser = userSnapshot.exists
      ? parsePersistedCompanyUser(userSnapshot.id, userSnapshot.data())
      : null;

    if (!companyUser) {
      return NextResponse.json(
        { success: false, message: "Company user not found." },
        { status: 404 }
      );
    }

    if (companyUser.companyId !== companyId) {
      return NextResponse.json(
        { success: false, message: "Company user relationship does not match." },
        { status: 409 }
      );
    }

    const snapshot = await adminDb
      .collection("projectMembers")
      .where("companyId", "==", companyId)
      .where("userId", "==", userId)
      .get();

    const candidateMemberships = snapshot.docs.flatMap((document) => {
      const data = document.data();

      if (
        data.companyId !== companyId ||
        data.userId !== userId ||
        !isValidFirestoreDocumentId(data.projectId) ||
        typeof data.active !== "boolean"
      ) {
        return [];
      }

      return [
        {
          companyId,
          projectId: data.projectId,
          userId,
          active: data.active,
        },
      ];
    });

    const projectIds = [
      ...new Set(candidateMemberships.map(({ projectId }) => projectId)),
    ];
    const projectSnapshots = projectIds.length
      ? await adminDb.getAll(
          ...projectIds.map((projectId) =>
            adminDb.collection("projects").doc(projectId)
          )
        )
      : [];
    const validProjectIds = new Set(
      projectSnapshots
        .filter(
          (projectSnapshot) =>
            projectSnapshot.exists &&
            projectSnapshot.data()?.companyId === companyId
        )
        .map((projectSnapshot) => projectSnapshot.id)
    );
    const memberships = candidateMemberships.filter(({ projectId }) =>
      validProjectIds.has(projectId)
    );

    return NextResponse.json({ success: true, memberships });
  } catch (error) {
    console.error("Project membership listing failed:", error);
    return NextResponse.json(
      { success: false, message: "Project membership listing failed." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const actorResult = await requireProjectProvisioningActor();

    if ("error" in actorResult) return actorResult.error;

    const body = await readJsonObject(request);

    if (
      !body ||
      !hasOnlyAllowedFields(body, [
        "companyId",
        "projectId",
        "userId",
        "active",
      ]) ||
      !validMembershipRequest(body)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid project membership request." },
        { status: 400 }
      );
    }

    const companyId = body.companyId as string;
    const projectId = body.projectId as string;
    const userId = body.userId as string;
    const active = body.active as boolean;
    const membershipId = projectMembershipDocumentId(projectId, userId);

    if (!membershipId) {
      return NextResponse.json(
        { success: false, message: "Project membership ID is too long." },
        { status: 400 }
      );
    }

    const companyRef = adminDb.collection("companies").doc(companyId);
    const projectRef = adminDb.collection("projects").doc(projectId);
    const userRef = adminDb.collection("users").doc(userId);
    const membershipRef = adminDb
      .collection("projectMembers")
      .doc(membershipId);

    await adminDb.runTransaction(async (transaction) => {
      const companySnapshot = await transaction.get(companyRef);
      const projectSnapshot = await transaction.get(projectRef);
      const userSnapshot = await transaction.get(userRef);
      const membershipSnapshot = await transaction.get(membershipRef);

      if (!companySnapshot.exists) {
        throw new MembershipProvisioningError("Company not found.", 404);
      }

      if (!projectSnapshot.exists) {
        throw new MembershipProvisioningError("Project not found.", 404);
      }

      if (!userSnapshot.exists) {
        throw new MembershipProvisioningError("Company user not found.", 404);
      }

      if (projectSnapshot.data()?.companyId !== companyId) {
        throw new MembershipProvisioningError(
          "Project does not belong to the requested company.",
          409
        );
      }

      const companyUser = parsePersistedCompanyUser(
        userSnapshot.id,
        userSnapshot.data()
      );

      if (!companyUser || companyUser.companyId !== companyId) {
        throw new MembershipProvisioningError(
          "Company user is invalid or belongs to another company.",
          409
        );
      }

      if (
        active &&
        (companySnapshot.data()?.active !== true ||
          companyUser.active !== true)
      ) {
        throw new MembershipProvisioningError(
          "Active membership requires an active company and user.",
          409
        );
      }

      if (membershipSnapshot.exists) {
        throw new MembershipProvisioningError(
          "Project membership already exists; use PATCH to manage it.",
          409
        );
      }

      transaction.create(membershipRef, {
        companyId,
        projectId,
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
        membership: {
          id: membershipId,
          companyId,
          projectId,
          userId,
          active,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return membershipError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actorResult = await requireProjectProvisioningActor();

    if ("error" in actorResult) return actorResult.error;

    const body = await readJsonObject(request);

    if (
      !body ||
      !hasOnlyAllowedFields(body, [
        "companyId",
        "projectId",
        "userId",
        "active",
      ]) ||
      !validMembershipRequest(body)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid project membership request." },
        { status: 400 }
      );
    }

    const companyId = body.companyId as string;
    const projectId = body.projectId as string;
    const userId = body.userId as string;
    const active = body.active as boolean;
    const membershipId = projectMembershipDocumentId(projectId, userId);

    if (!membershipId) {
      return NextResponse.json(
        { success: false, message: "Project membership ID is too long." },
        { status: 400 }
      );
    }

    const companyRef = adminDb.collection("companies").doc(companyId);
    const projectRef = adminDb.collection("projects").doc(projectId);
    const userRef = adminDb.collection("users").doc(userId);
    const membershipRef = adminDb
      .collection("projectMembers")
      .doc(membershipId);

    await adminDb.runTransaction(async (transaction) => {
      const companySnapshot = await transaction.get(companyRef);
      const projectSnapshot = await transaction.get(projectRef);
      const userSnapshot = await transaction.get(userRef);
      const membershipSnapshot = await transaction.get(membershipRef);

      if (!companySnapshot.exists || !projectSnapshot.exists) {
        throw new MembershipProvisioningError(
          "Company or project not found.",
          404
        );
      }

      if (!userSnapshot.exists || !membershipSnapshot.exists) {
        throw new MembershipProvisioningError(
          "Company user or project membership not found.",
          404
        );
      }

      const membership = membershipSnapshot.data();
      const userData = userSnapshot.data();

      if (
        projectSnapshot.data()?.companyId !== companyId ||
        userData?.companyId !== companyId ||
        membership?.companyId !== companyId ||
        membership?.projectId !== projectId ||
        membership?.userId !== userId
      ) {
        throw new MembershipProvisioningError(
          "Project membership relationships do not match.",
          409
        );
      }

      if (active) {
        const companyUser = parsePersistedCompanyUser(
          userSnapshot.id,
          userData
        );

        if (
          !companyUser ||
          companySnapshot.data()?.active !== true ||
          companyUser.active !== true
        ) {
          throw new MembershipProvisioningError(
            "Active membership requires a valid active company and user.",
            409
          );
        }
      }

      transaction.update(membershipRef, {
        active,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return membershipError(error);
  }
}
