import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { parsePersistedOrganizationUnit } from "@/lib/organization-units";
import {
  ProcedureAccessError,
  requireProcedureActor,
  requireProcedureReadAccess,
  requireProcedureWriteContext,
} from "@/lib/procedure-authorization";
import {
  parsePersistedProcedure,
  parsePersistedProcedureStep,
  parseProcedureStepCreateInput,
  parseProcedureStepPatchInput,
  Performer,
  PersistedProcedure,
  ProcedureStepWriteData,
  publicProcedureStep,
} from "@/lib/procedures";
import { isValidFirestoreDocumentId, readJsonObject } from "@/lib/request-validation";
import { parsePersistedCompanyUser, TenantAccessError } from "@/lib/tenant-auth";
import { companyUserActorPath } from "@/lib/tenant-model";

const STEP_LIST_LIMIT = 500;

function errorResponse(error: unknown) {
  if (error instanceof ProcedureAccessError || error instanceof TenantAccessError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: error.status }
    );
  }
  console.error("Procedure step operation failed:", error);
  return NextResponse.json(
    { success: false, message: "Procedure step operation failed." },
    { status: 500 }
  );
}

function performerUsers(step: ProcedureStepWriteData): string[] {
  const performers: Array<Performer | undefined> = [
    step.performer,
    step.review?.performer,
    step.approval?.performer,
  ];
  return [...new Set(performers.flatMap((performer) =>
    performer?.type === "user" && performer.userId ? [performer.userId] : []
  ))];
}

async function validateStepReferences(
  transaction: FirebaseFirestore.Transaction,
  step: ProcedureStepWriteData,
  procedure: PersistedProcedure
) {
  if (
    step.companyId !== procedure.companyId ||
    step.projectId !== procedure.projectId ||
    step.procedureId !== procedure.id
  ) {
    throw new ProcedureAccessError("Step relationship is invalid.", 409);
  }

  if (step.organizationUnitId) {
    const unitSnapshot = await transaction.get(
      adminDb.collection("organizationUnits").doc(step.organizationUnitId)
    );
    const unit = unitSnapshot.exists
      ? parsePersistedOrganizationUnit(unitSnapshot.id, unitSnapshot.data())
      : null;
    if (!unit || unit.companyId !== procedure.companyId || !unit.active) {
      throw new ProcedureAccessError(
        "Step organization unit must be active and belong to the procedure company.",
        409
      );
    }
  }

  for (const userId of performerUsers(step)) {
    const userSnapshot = await transaction.get(adminDb.collection("users").doc(userId));
    const user = userSnapshot.exists
      ? parsePersistedCompanyUser(userSnapshot.id, userSnapshot.data())
      : null;
    if (!user || user.companyId !== procedure.companyId || !user.active) {
      throw new ProcedureAccessError(
        "User performer must be active and belong to the procedure company.",
        409
      );
    }
  }
}

async function assertUniqueActiveSequence(
  transaction: FirebaseFirestore.Transaction,
  step: ProcedureStepWriteData,
  excludedStepId?: string
) {
  if (!step.active) return;
  const snapshot = await transaction.get(
    adminDb
      .collection("procedureSteps")
      .where("procedureId", "==", step.procedureId)
      .where("sequence", "==", step.sequence)
  );
  const duplicate = snapshot.docs.some((document) => {
    if (document.id === excludedStepId) return false;
    const existing = parsePersistedProcedureStep(document.id, document.data());
    return existing?.active === true &&
      existing.companyId === step.companyId &&
      existing.projectId === step.projectId &&
      existing.procedureId === step.procedureId &&
      existing.sequence === step.sequence;
  });
  if (duplicate) {
    throw new ProcedureAccessError(
      "Two active steps cannot use the same procedure sequence.",
      409
    );
  }
}

export async function GET(request: Request) {
  try {
    const actor = await requireProcedureActor();
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];
    const allowed = new Set(["procedureId", "active"]);
    if (
      keys.some((key) => !allowed.has(key)) ||
      params.getAll("procedureId").length !== 1 ||
      params.getAll("active").length > 1
    ) {
      return NextResponse.json(
        { success: false, message: "Unexpected procedure-step query." },
        { status: 400 }
      );
    }
    const procedureId = params.get("procedureId");
    const activeValue = params.get("active");
    if (
      !procedureId || !isValidFirestoreDocumentId(procedureId) ||
      (activeValue !== null && activeValue !== "true" && activeValue !== "false")
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid procedure-step query." },
        { status: 400 }
      );
    }
    const procedureSnapshot = await adminDb.collection("procedures").doc(procedureId).get();
    const procedure = procedureSnapshot.exists
      ? parsePersistedProcedure(procedureSnapshot.id, procedureSnapshot.data())
      : null;
    if (!procedure) {
      return NextResponse.json(
        { success: false, message: "Procedure not found." },
        { status: 404 }
      );
    }
    await requireProcedureReadAccess(procedure, actor);
    const snapshot = await adminDb
      .collection("procedureSteps")
      .where("procedureId", "==", procedureId)
      .limit(STEP_LIST_LIMIT + 1)
      .get();
    const steps = snapshot.docs
      .slice(0, STEP_LIST_LIMIT)
      .flatMap((document) => {
        const step = parsePersistedProcedureStep(document.id, document.data());
        return step &&
          step.companyId === procedure.companyId &&
          step.projectId === procedure.projectId &&
          step.procedureId === procedure.id &&
          (activeValue === null || step.active === (activeValue === "true"))
          ? [publicProcedureStep(step)]
          : [];
      })
      .sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name, "ar"));
    return NextResponse.json({
      success: true,
      steps,
      truncated: snapshot.size > STEP_LIST_LIMIT,
      limit: STEP_LIST_LIMIT,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireProcedureActor();
    const body = await readJsonObject(request);
    const input = parseProcedureStepCreateInput(body);
    if (!input) {
      return NextResponse.json(
        { success: false, message: "Invalid procedure-step request." },
        { status: 400 }
      );
    }
    const stepRef = adminDb.collection("procedureSteps").doc();
    await adminDb.runTransaction(async (transaction) => {
      const procedureSnapshot = await transaction.get(
        adminDb.collection("procedures").doc(input.procedureId)
      );
      const procedure = procedureSnapshot.exists
        ? parsePersistedProcedure(procedureSnapshot.id, procedureSnapshot.data())
        : null;
      if (!procedure) throw new ProcedureAccessError("Procedure not found.", 404);
      const canonicalActor = await requireProcedureWriteContext(
        transaction,
        actor,
        procedure.companyId,
        procedure.projectId,
        procedure.organizationUnitId
      );
      await validateStepReferences(transaction, input, procedure);
      await assertUniqueActiveSequence(transaction, input);
      const actorPath = companyUserActorPath(canonicalActor.id);
      transaction.update(procedureSnapshot.ref, {
        updatedBy: actorPath,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(stepRef, {
        ...input,
        createdBy: actorPath,
        updatedBy: actorPath,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json(
      { success: true, step: { id: stepRef.id, ...input } },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireProcedureActor();
    const body = await readJsonObject(request);
    const patch = parseProcedureStepPatchInput(body);
    if (!patch) {
      return NextResponse.json(
        { success: false, message: "Invalid procedure-step update." },
        { status: 400 }
      );
    }
    const stepRef = adminDb.collection("procedureSteps").doc(patch.stepId);
    await adminDb.runTransaction(async (transaction) => {
      const stepSnapshot = await transaction.get(stepRef);
      const current = stepSnapshot.exists
        ? parsePersistedProcedureStep(stepSnapshot.id, stepSnapshot.data())
        : null;
      if (!current) throw new ProcedureAccessError("Procedure step not found.", 404);
      const procedureSnapshot = await transaction.get(
        adminDb.collection("procedures").doc(current.procedureId)
      );
      const procedure = procedureSnapshot.exists
        ? parsePersistedProcedure(procedureSnapshot.id, procedureSnapshot.data())
        : null;
      if (!procedure) throw new ProcedureAccessError("Procedure not found.", 404);
      const currentData = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== "id")
      );
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([key]) => key !== "stepId")
      );
      const next = parseProcedureStepCreateInput({ ...currentData, ...changes });
      if (!next) throw new ProcedureAccessError("Procedure-step update is invalid.", 400);
      const canonicalActor = await requireProcedureWriteContext(
        transaction,
        actor,
        procedure.companyId,
        procedure.projectId,
        procedure.organizationUnitId
      );
      await validateStepReferences(transaction, next, procedure);
      await assertUniqueActiveSequence(transaction, next, current.id);
      const actorPath = companyUserActorPath(canonicalActor.id);
      transaction.update(procedureSnapshot.ref, {
        updatedBy: actorPath,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(stepRef, {
        ...changes,
        updatedBy: actorPath,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
