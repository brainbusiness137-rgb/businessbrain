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
  parseProcedureCreateInput,
  parseProcedurePatchInput,
  PROCEDURE_STATUSES,
  publicProcedure,
} from "@/lib/procedures";
import { isValidFirestoreDocumentId, readJsonObject } from "@/lib/request-validation";
import { requireProjectAccess, TenantAccessError } from "@/lib/tenant-auth";
import { companyUserActorPath } from "@/lib/tenant-model";

const PROCEDURE_LIST_LIMIT = 200;

function errorResponse(error: unknown) {
  if (error instanceof ProcedureAccessError || error instanceof TenantAccessError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: error.status }
    );
  }
  console.error("Procedure operation failed:", error);
  return NextResponse.json(
    { success: false, message: "Procedure operation failed." },
    { status: 500 }
  );
}

function singleValue(params: URLSearchParams, key: string) {
  return params.getAll(key).length <= 1;
}

export async function GET(request: Request) {
  try {
    const actor = await requireProcedureActor();
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];

    if (keys.length === 1 && keys[0] === "procedureId") {
      const procedureId = params.get("procedureId");
      if (!procedureId || !isValidFirestoreDocumentId(procedureId)) {
        return NextResponse.json(
          { success: false, message: "A valid procedure is required." },
          { status: 400 }
        );
      }
      const snapshot = await adminDb.collection("procedures").doc(procedureId).get();
      const procedure = snapshot.exists
        ? parsePersistedProcedure(snapshot.id, snapshot.data())
        : null;
      if (!procedure) {
        return NextResponse.json(
          { success: false, message: "Procedure not found." },
          { status: 404 }
        );
      }
      await requireProcedureReadAccess(procedure, actor);
      return NextResponse.json({ success: true, procedure: publicProcedure(procedure) });
    }

    const allowed = new Set(["projectId", "organizationUnitId", "status", "active"]);
    if (
      keys.some((key) => !allowed.has(key)) ||
      params.getAll("projectId").length !== 1 ||
      !singleValue(params, "organizationUnitId") ||
      !singleValue(params, "status") ||
      !singleValue(params, "active")
    ) {
      return NextResponse.json(
        { success: false, message: "Unexpected procedure query." },
        { status: 400 }
      );
    }
    const projectId = params.get("projectId");
    const organizationUnitId = params.get("organizationUnitId");
    const status = params.get("status");
    const activeValue = params.get("active");
    if (
      !projectId || !isValidFirestoreDocumentId(projectId) ||
      (organizationUnitId !== null && !isValidFirestoreDocumentId(organizationUnitId)) ||
      (status !== null && !PROCEDURE_STATUSES.includes(status as never)) ||
      (activeValue !== null && activeValue !== "true" && activeValue !== "false")
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid procedure query." },
        { status: 400 }
      );
    }

    const context = await requireProjectAccess(projectId, actor);
    const snapshot = await adminDb
      .collection("procedures")
      .where("projectId", "==", projectId)
      .limit(PROCEDURE_LIST_LIMIT + 1)
      .get();
    const parsed = snapshot.docs.slice(0, PROCEDURE_LIST_LIMIT).flatMap((document) => {
      const procedure = parsePersistedProcedure(document.id, document.data());
      return procedure &&
        procedure.companyId === actor.companyId &&
        procedure.companyId === context.company.id &&
        procedure.projectId === projectId &&
        (organizationUnitId === null || procedure.organizationUnitId === organizationUnitId) &&
        (status === null || procedure.status === status) &&
        (activeValue === null || procedure.active === (activeValue === "true"))
        ? [procedure]
        : [];
    });
    const unitIds = [...new Set(parsed.map(({ organizationUnitId: id }) => id))];
    const unitSnapshots = unitIds.length
      ? await adminDb.getAll(
          ...unitIds.map((id) => adminDb.collection("organizationUnits").doc(id))
        )
      : [];
    const validUnitIds = new Set(
      unitSnapshots.flatMap((unitSnapshot) => {
        const unit = unitSnapshot.exists
          ? parsePersistedOrganizationUnit(unitSnapshot.id, unitSnapshot.data())
          : null;
        return unit && unit.companyId === actor.companyId ? [unit.id] : [];
      })
    );
    const procedures = parsed
      .filter((procedure) => validUnitIds.has(procedure.organizationUnitId))
      .map(publicProcedure)
      .sort((left, right) => left.name.localeCompare(right.name, "ar"));

    return NextResponse.json({
      success: true,
      procedures,
      truncated: snapshot.size > PROCEDURE_LIST_LIMIT,
      limit: PROCEDURE_LIST_LIMIT,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireProcedureActor();
    const body = await readJsonObject(request);
    const input = parseProcedureCreateInput(body);
    if (!input) {
      return NextResponse.json(
        { success: false, message: "Invalid procedure request." },
        { status: 400 }
      );
    }
    const procedureRef = adminDb.collection("procedures").doc();
    await adminDb.runTransaction(async (transaction) => {
      const canonicalActor = await requireProcedureWriteContext(
        transaction,
        actor,
        input.companyId,
        input.projectId,
        input.organizationUnitId
      );
      const actorPath = companyUserActorPath(canonicalActor.id);
      transaction.create(procedureRef, {
        ...input,
        createdBy: actorPath,
        updatedBy: actorPath,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json(
      { success: true, procedure: { id: procedureRef.id, ...input } },
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
    const patch = parseProcedurePatchInput(body);
    if (!patch) {
      return NextResponse.json(
        { success: false, message: "Invalid procedure update." },
        { status: 400 }
      );
    }
    const procedureRef = adminDb.collection("procedures").doc(patch.procedureId);
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(procedureRef);
      const current = snapshot.exists
        ? parsePersistedProcedure(snapshot.id, snapshot.data())
        : null;
      if (!current) throw new ProcedureAccessError("Procedure not found.", 404);
      const currentData = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== "id")
      );
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([key]) => key !== "procedureId")
      );
      const next = parseProcedureCreateInput({ ...currentData, ...changes });
      if (!next) throw new ProcedureAccessError("Procedure update is invalid.", 400);

      const canonicalActor = await requireProcedureWriteContext(
        transaction,
        actor,
        current.companyId,
        current.projectId,
        current.organizationUnitId
      );
      if (next.organizationUnitId !== current.organizationUnitId) {
        await requireProcedureWriteContext(
          transaction,
          actor,
          current.companyId,
          current.projectId,
          next.organizationUnitId
        );
      }
      transaction.update(procedureRef, {
        ...changes,
        updatedBy: companyUserActorPath(canonicalActor.id),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
