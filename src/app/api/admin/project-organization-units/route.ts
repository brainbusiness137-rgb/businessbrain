import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { getCurrentPlatformUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import {
  parsePersistedOrganizationUnit,
  parsePersistedProjectOrganizationUnit,
} from "@/lib/organization-units";
import { hasPlatformAuthority, PERMISSIONS } from "@/lib/permissions";
import {
  hasOnlyAllowedFields,
  isValidFirestoreDocumentId,
  readJsonObject,
} from "@/lib/request-validation";
import {
  platformActorPath,
  projectOrganizationUnitDocumentId,
} from "@/lib/tenant-model";

class ProjectUnitError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 409
  ) {
    super(message);
  }
}

function projectUnitError(error: unknown) {
  if (error instanceof ProjectUnitError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: error.status }
    );
  }

  console.error("Project organization-unit operation failed:", error);
  return NextResponse.json(
    { success: false, message: "Project organization-unit operation failed." },
    { status: 500 }
  );
}

async function requireProjectActor() {
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

function validRequest(body: Record<string, unknown>): boolean {
  return (
    typeof body.companyId === "string" &&
    isValidFirestoreDocumentId(body.companyId) &&
    typeof body.projectId === "string" &&
    isValidFirestoreDocumentId(body.projectId) &&
    typeof body.organizationUnitId === "string" &&
    isValidFirestoreDocumentId(body.organizationUnitId) &&
    typeof body.active === "boolean"
  );
}

function validProject(
  projectId: string,
  data: FirebaseFirestore.DocumentData | undefined,
  companyId: string
) {
  return (
    isValidFirestoreDocumentId(projectId) &&
    data?.companyId === companyId &&
    typeof data.name === "string" &&
    data.name.trim().length > 0 &&
    typeof data.status === "string"
  );
}

export async function GET(request: Request) {
  try {
    const actorResult = await requireProjectActor();
    if ("error" in actorResult) return actorResult.error;

    const searchParams = new URL(request.url).searchParams;
    const allowed = new Set(["companyId", "organizationUnitId"]);

    if (
      [...searchParams.keys()].some((key) => !allowed.has(key)) ||
      searchParams.getAll("companyId").length !== 1 ||
      searchParams.getAll("organizationUnitId").length !== 1
    ) {
      return NextResponse.json(
        { success: false, message: "Unexpected project-unit query." },
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
      ? parsePersistedOrganizationUnit(
          unitSnapshot.id,
          unitSnapshot.data()
        )
      : null;

    if (!companySnapshot.exists || !unit || unit.companyId !== companyId) {
      return NextResponse.json(
        { success: false, message: "Company or organization unit not found." },
        { status: 404 }
      );
    }

    const snapshot = await adminDb
      .collection("projectOrganizationUnits")
      .where("companyId", "==", companyId)
      .where("organizationUnitId", "==", organizationUnitId)
      .get();
    const candidates = snapshot.docs.flatMap((document) => {
      const relationship = parsePersistedProjectOrganizationUnit(
        document.id,
        document.data()
      );

      if (
        !relationship ||
        relationship.companyId !== companyId ||
        relationship.organizationUnitId !== organizationUnitId
      ) {
        return [];
      }

      return [
        {
          companyId,
          projectId: relationship.projectId,
          organizationUnitId,
          active: relationship.active,
        },
      ];
    });
    const projectIds = [...new Set(candidates.map(({ projectId }) => projectId))];
    const projectSnapshots = projectIds.length
      ? await adminDb.getAll(
          ...projectIds.map((projectId) =>
            adminDb.collection("projects").doc(projectId)
          )
        )
      : [];
    const validProjectIds = new Set(
      projectSnapshots
        .filter((project) =>
          project.exists && validProject(project.id, project.data(), companyId)
        )
        .map((project) => project.id)
    );

    return NextResponse.json({
      success: true,
      assignments: candidates.filter(({ projectId }) =>
        validProjectIds.has(projectId)
      ),
    });
  } catch (error) {
    console.error("Project organization-unit listing failed:", error);
    return NextResponse.json(
      { success: false, message: "Project organization-unit listing failed." },
      { status: 500 }
    );
  }
}

async function readActiveReferences(
  transaction: FirebaseFirestore.Transaction,
  companyId: string,
  projectId: string,
  organizationUnitId: string
) {
  const companyRef = adminDb.collection("companies").doc(companyId);
  const projectRef = adminDb.collection("projects").doc(projectId);
  const unitRef = adminDb
    .collection("organizationUnits")
    .doc(organizationUnitId);
  const [companySnapshot, projectSnapshot, unitSnapshot] = await Promise.all([
    transaction.get(companyRef),
    transaction.get(projectRef),
    transaction.get(unitRef),
  ]);
  const unit = unitSnapshot.exists
    ? parsePersistedOrganizationUnit(unitSnapshot.id, unitSnapshot.data())
    : null;

  if (!companySnapshot.exists || !projectSnapshot.exists || !unitSnapshot.exists) {
    throw new ProjectUnitError("Company, project, or unit not found.", 404);
  }

  if (
    companySnapshot.data()?.active !== true ||
    !validProject(projectSnapshot.id, projectSnapshot.data(), companyId) ||
    projectSnapshot.data()?.status !== "active" ||
    !unit ||
    unit.companyId !== companyId ||
    unit.active !== true
  ) {
    throw new ProjectUnitError(
      "Active assignment requires an active same-company project and unit.",
      409
    );
  }
}

async function mutate(request: Request, creating: boolean) {
  const actorResult = await requireProjectActor();
  if ("error" in actorResult) return actorResult.error;

  const body = await readJsonObject(request);
  if (
    !body ||
    !hasOnlyAllowedFields(body, [
      "companyId",
      "projectId",
      "organizationUnitId",
      "active",
    ]) ||
    !validRequest(body)
  ) {
    return NextResponse.json(
      { success: false, message: "Invalid project-unit request." },
      { status: 400 }
    );
  }

  const companyId = body.companyId as string;
  const projectId = body.projectId as string;
  const organizationUnitId = body.organizationUnitId as string;
  const active = body.active as boolean;
  const relationshipId = projectOrganizationUnitDocumentId(
    projectId,
    organizationUnitId
  );

  if (!relationshipId) {
    return NextResponse.json(
      { success: false, message: "Project-unit ID is too long." },
      { status: 400 }
    );
  }

  const relationshipRef = adminDb
    .collection("projectOrganizationUnits")
    .doc(relationshipId);

  await adminDb.runTransaction(async (transaction) => {
    if (creating || active) {
      await readActiveReferences(
        transaction,
        companyId,
        projectId,
        organizationUnitId
      );
    }

    const relationshipSnapshot = await transaction.get(relationshipRef);

    if (creating) {
      if (relationshipSnapshot.exists) {
        throw new ProjectUnitError(
          "Project-unit assignment already exists; use PATCH to manage it.",
          409
        );
      }

      transaction.create(relationshipRef, {
        companyId,
        projectId,
        organizationUnitId,
        active,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: platformActorPath(actorResult.actor.id),
      });
      return;
    }

    if (!relationshipSnapshot.exists) {
      throw new ProjectUnitError("Project-unit assignment not found.", 404);
    }

    const relationship = relationshipSnapshot.data();
    if (
      relationship?.companyId !== companyId ||
      relationship?.projectId !== projectId ||
      relationship?.organizationUnitId !== organizationUnitId
    ) {
      throw new ProjectUnitError(
        "Project-unit assignment relationships do not match.",
        409
      );
    }

    transaction.update(relationshipRef, {
      active,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return NextResponse.json(
    creating
      ? {
          success: true,
          assignment: { companyId, projectId, organizationUnitId, active },
        }
      : { success: true },
    creating ? { status: 201 } : undefined
  );
}

export async function POST(request: Request) {
  try {
    return await mutate(request, true);
  } catch (error) {
    return projectUnitError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    return await mutate(request, false);
  } catch (error) {
    return projectUnitError(error);
  }
}
