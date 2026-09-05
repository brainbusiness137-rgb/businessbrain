import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { GuidedAccessError, requireGuidedActor, requireSessionAccess, requireSessionWriteContext } from "@/lib/guided-authorization";
import { parsePersistedAnswer, parsePersistedCandidate, parsePersistedClarification, parsePersistedSession } from "@/lib/guided-documentation";
import { buildV14Projection, conversionReadinessError, v2ProjectionAnswers } from "@/lib/guided-question-registry";
import { MAX_GUIDED_ANSWERS_PER_CANDIDATE, guidedError } from "@/lib/guided-store";
import { parsePersistedOrganizationUnit } from "@/lib/organization-units";
import { parseProcedureStepCreateInput } from "@/lib/procedures";
import { isValidFirestoreDocumentId, readJsonObject } from "@/lib/request-validation";
import { parsePersistedCompanyUser } from "@/lib/tenant-auth";
import { companyUserActorPath } from "@/lib/tenant-model";
import { traceGuidedOperation } from "@/lib/guided-observability";

export async function POST(request: Request) {
  try {
    const actor = await requireGuidedActor(); const body = await readJsonObject(request);
    if (!body || Object.keys(body).some((key) => !["sessionId", "candidateId", "explicitConfirm"].includes(key)) || typeof body.sessionId !== "string" || !isValidFirestoreDocumentId(body.sessionId) || body.candidateId !== undefined && (typeof body.candidateId !== "string" || !isValidFirestoreDocumentId(body.candidateId)) || body.explicitConfirm !== true) throw new GuidedAccessError("Explicit valid conversion confirmation is required.", 400);
    const session = await requireSessionAccess(body.sessionId, actor); const v2 = session.engineVersion === "guided-v2"; const candidateId = body.candidateId; if (v2 && candidateId !== undefined || !v2 && typeof candidateId !== "string") throw new GuidedAccessError("Invalid conversion working identity.", 400); const procedureRef = adminDb.collection("procedures").doc();
    const result = await adminDb.runTransaction(async (transaction) => {
      const sessionRef = adminDb.collection("documentationSessions").doc(session.id); const candidateRef = v2 ? null : adminDb.collection("procedureCandidates").doc(candidateId as string);
      const [sessionSnapshot, candidateSnapshot] = await Promise.all([transaction.get(sessionRef), candidateRef ? transaction.get(candidateRef) : Promise.resolve(null)]);
      const currentSession = sessionSnapshot.exists ? parsePersistedSession(sessionSnapshot.id, sessionSnapshot.data()) : null; const storedCandidate = candidateSnapshot?.exists ? parsePersistedCandidate(candidateSnapshot.id, candidateSnapshot.data()) : null;
      if (!currentSession || !v2 && (!storedCandidate || storedCandidate.sessionId !== currentSession.id || storedCandidate.companyId !== currentSession.companyId || storedCandidate.projectId !== currentSession.projectId || storedCandidate.organizationUnitId !== currentSession.organizationUnitId)) throw new GuidedAccessError("Guided working identity is invalid.", 409);
      const canonical = await requireSessionWriteContext(transaction, actor, currentSession);
      if (storedCandidate?.status === "converted") return { procedureId: storedCandidate.procedureId as string, existing: true, writeCount: 0 };
      if (!currentSession.active || currentSession.status !== "active" || !["documentation", "confirmation"].includes(currentSession.phase) || !v2 && (storedCandidate?.classification !== "procedure" || storedCandidate.status !== "confirmed_procedure")) throw new GuidedAccessError("Guided session is not eligible for conversion.", 409);
      const [answerSnapshots, clarificationSnapshots] = await Promise.all([
        transaction.get(adminDb.collection("guidedAnswers").where(v2 ? "sessionId" : "candidateId", "==", v2 ? currentSession.id : storedCandidate!.id).limit(MAX_GUIDED_ANSWERS_PER_CANDIDATE + 1)),
        transaction.get(adminDb.collection("clarificationItems").where(v2 ? "sessionId" : "candidateId", "==", v2 ? currentSession.id : storedCandidate!.id).limit(201)),
      ]);
      if (answerSnapshots.size > MAX_GUIDED_ANSWERS_PER_CANDIDATE || clarificationSnapshots.size > 200) throw new GuidedAccessError("Guided working-state limit exceeded.", 409);
      const answers = answerSnapshots.docs.map((document) => { const answer = parsePersistedAnswer(document.id, document.data()); if (!answer || answer.sessionId !== currentSession.id || answer.companyId !== currentSession.companyId || answer.projectId !== currentSession.projectId || answer.organizationUnitId !== currentSession.organizationUnitId || answer.candidateId !== (v2 ? currentSession.id : storedCandidate!.id)) throw new GuidedAccessError("Guided answer integrity validation failed.", 409); return answer; }).filter((answer) => answer.active);
      const clarifications = clarificationSnapshots.docs.map((document) => { const item = parsePersistedClarification(document.id, document.data()); if (!item || item.sessionId !== currentSession.id || item.companyId !== currentSession.companyId || item.projectId !== currentSession.projectId || item.organizationUnitId !== currentSession.organizationUnitId || item.candidateId !== (v2 ? currentSession.id : storedCandidate!.id)) throw new GuidedAccessError("Clarification integrity validation failed.", 409); return item; });
      if (clarifications.some((item) => item.active && item.status === "open" && item.severity === "required")) throw new GuidedAccessError("Required clarifications must be resolved before conversion.", 409);
      const workingIdentity = storedCandidate ?? { id: currentSession.id, companyId: currentSession.companyId, projectId: currentSession.projectId, organizationUnitId: currentSession.organizationUnitId, sessionId: currentSession.id, label: "V2 procedure", classification: "procedure" as const, status: "confirmed_procedure" as const, originQuestionId: "procedure.name", active: true, createdBy: currentSession.createdBy, updatedBy: currentSession.updatedBy };
      const projectionAnswers = v2 ? v2ProjectionAnswers(answers, currentSession.id) : answers;
      const readinessError = conversionReadinessError(workingIdentity, projectionAnswers); if (readinessError) throw new GuidedAccessError(readinessError, 409);
      const projection = buildV14Projection(workingIdentity, projectionAnswers); if (!projection || projection.steps.length === 0 || projection.steps.length > 100) throw new GuidedAccessError("Guided answers do not form a valid V1.4 procedure.", 409);
      const steps = projection.steps.map((step) => parseProcedureStepCreateInput({ ...step, procedureId: procedureRef.id }));
      if (steps.some((step) => !step)) throw new GuidedAccessError("Projected procedure steps failed V1.4 validation.", 409);
      const stepRefs = steps.map(() => adminDb.collection("procedureSteps").doc());
      for (const step of steps) {
        if (!step) continue;
        if (step.organizationUnitId) { const snapshot = await transaction.get(adminDb.collection("organizationUnits").doc(step.organizationUnitId)); const unit = snapshot.exists ? parsePersistedOrganizationUnit(snapshot.id, snapshot.data()) : null; if (!unit || !unit.active || unit.companyId !== currentSession.companyId) throw new GuidedAccessError("Projected organization-unit reference is invalid.", 409); }
        for (const performer of [step.performer, step.review?.performer, step.approval?.performer]) if (performer?.type === "user" && performer.userId) { const snapshot = await transaction.get(adminDb.collection("users").doc(performer.userId)); const user = snapshot.exists ? parsePersistedCompanyUser(snapshot.id, snapshot.data()) : null; if (!user || !user.active || user.companyId !== currentSession.companyId) throw new GuidedAccessError("Projected user reference is invalid.", 409); }
      }
      const actorPath = companyUserActorPath(canonical.id); const now = FieldValue.serverTimestamp();
      transaction.create(procedureRef, { ...projection.procedure, createdBy: actorPath, updatedBy: actorPath, createdAt: now, updatedAt: now });
      steps.forEach((step, index) => transaction.create(stepRefs[index], { ...step!, createdBy: actorPath, updatedBy: actorPath, createdAt: now, updatedAt: now }));
      if (candidateRef) transaction.update(candidateRef, { status: "converted", active: false, procedureId: procedureRef.id, convertedAt: now, convertedBy: actorPath, updatedBy: actorPath, updatedAt: now });
      transaction.update(sessionRef, v2 ? { phase: "completed", status: "completed", active: false, completedAt: now, updatedBy: actorPath, updatedAt: now, lastActivityAt: now } : { phase: "confirmation", currentCandidateId: storedCandidate!.id, updatedBy: actorPath, updatedAt: now, lastActivityAt: now });
      return { procedureId: procedureRef.id, existing: false, writeCount: steps.length + (v2 ? 2 : 3) };
    });
    traceGuidedOperation({ operation: v2 ? "guided-conversion.v2" : "guided-conversion.legacy", queries: 2, writesAtLeast: result.writeCount, evidenceLoads: 2 });
    return NextResponse.json({ success: true, procedureId: result.procedureId, existing: result.existing });
  } catch (error) { return guidedError(error); }
}
