import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { GuidedAccessError, requireGuidedActor, requireSessionAccess, requireSessionWriteContext } from "@/lib/guided-authorization";
import { CANDIDATE_CLASSIFICATIONS, parseCandidateCreate, parsePersistedAnswer, parsePersistedCandidate, parsePersistedSession } from "@/lib/guided-documentation";
import { nextQuestionForStages, QUESTION_REGISTRY } from "@/lib/guided-question-registry";
import { MAX_GUIDED_ANSWERS_PER_CANDIDATE, exactQuery, guidedError, loadCandidates } from "@/lib/guided-store";
import { isValidFirestoreDocumentId, readJsonObject } from "@/lib/request-validation";
import { companyUserActorPath } from "@/lib/tenant-model";

export async function GET(request: Request) {
  try {
    const actor = await requireGuidedActor(); const params = new URL(request.url).searchParams;
    if (!exactQuery(params, ["sessionId"])) throw new GuidedAccessError("A session is required.", 400);
    const sessionId = params.get("sessionId"); if (!sessionId || !isValidFirestoreDocumentId(sessionId)) throw new GuidedAccessError("Invalid session.", 400);
    const session = await requireSessionAccess(sessionId, actor); const result = await loadCandidates(session);
    return NextResponse.json({ success: true, ...result, limit: 100 });
  } catch (error) { return guidedError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireGuidedActor(); const input = parseCandidateCreate(await readJsonObject(request));
    if (!input) throw new GuidedAccessError("Invalid candidate request.", 400);
    const originQuestion = QUESTION_REGISTRY.get(input.originQuestionId);
    if (!originQuestion || originQuestion.stage !== "discovery_context" || originQuestion.subjectType !== "session") throw new GuidedAccessError("Candidate origin must be a discovery question.", 400);
    const session = await requireSessionAccess(input.sessionId, actor); const ref = adminDb.collection("procedureCandidates").doc();
    await adminDb.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(adminDb.collection("documentationSessions").doc(session.id));
      const current = sessionSnapshot.exists ? parsePersistedSession(sessionSnapshot.id, sessionSnapshot.data()) : null;
      if (!current || !current.active || current.status !== "active" || current.phase !== "discovery") throw new GuidedAccessError("Session is not accepting discovery candidates.", 409);
      const canonical = await requireSessionWriteContext(transaction, actor, current); const answerSnapshots = await transaction.get(adminDb.collection("guidedAnswers").where("sessionId", "==", current.id).limit(1001)); if (answerSnapshots.size > 1000) throw new GuidedAccessError("Guided answer limit exceeded.", 409); const answers = answerSnapshots.docs.flatMap((document) => { const answer = parsePersistedAnswer(document.id, document.data()); return answer && answer.active && answer.companyId === current.companyId && answer.projectId === current.projectId && answer.organizationUnitId === current.organizationUnitId && answer.sessionId === current.id && answer.subjectType === "session" ? [answer] : []; }); const authoritative = nextQuestionForStages(answers, current.id, "session", ["discovery_context"]); if (!authoritative || authoritative.id !== input.originQuestionId || authoritative.id === "discovery.complete") throw new GuidedAccessError("Candidate origin is not the authoritative discovery question.", 409); const existing = await transaction.get(adminDb.collection("procedureCandidates").where("sessionId", "==", current.id).limit(101));
      if (existing.size >= 100) throw new GuidedAccessError("Candidate limit reached.", 409);
      const actorPath = companyUserActorPath(canonical.id); const now = FieldValue.serverTimestamp();
      transaction.create(ref, { companyId: current.companyId, projectId: current.projectId, organizationUnitId: current.organizationUnitId, sessionId: current.id, label: input.label, classification: "unclassified", status: "discovered", originQuestionId: input.originQuestionId, active: true, ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}), createdBy: actorPath, updatedBy: actorPath, createdAt: now, updatedAt: now });
      transaction.update(sessionSnapshot.ref, { updatedBy: actorPath, updatedAt: now, lastActivityAt: now });
    });
    return NextResponse.json({ success: true, candidateId: ref.id }, { status: 201 });
  } catch (error) { return guidedError(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireGuidedActor(); const body = await readJsonObject(request);
    const allowed = ["sessionId", "candidateId", "action", "label", "sourceText", "classification", "relatedCandidateId", "exclusionReason"];
    if (!body || Object.keys(body).some((key) => !allowed.includes(key)) || typeof body.sessionId !== "string" || !isValidFirestoreDocumentId(body.sessionId) || typeof body.candidateId !== "string" || !isValidFirestoreDocumentId(body.candidateId) || !["refine", "classify", "exclude", "confirm_procedure"].includes(String(body.action))) throw new GuidedAccessError("Invalid candidate update.", 400);
    const sessionId = body.sessionId as string; const candidateId = body.candidateId as string;
    const session = await requireSessionAccess(sessionId, actor); const candidateRef = adminDb.collection("procedureCandidates").doc(candidateId);
    await adminDb.runTransaction(async (transaction) => {
      const [sessionSnapshot, candidateSnapshot] = await Promise.all([transaction.get(adminDb.collection("documentationSessions").doc(session.id)), transaction.get(candidateRef)]);
      const currentSession = sessionSnapshot.exists ? parsePersistedSession(sessionSnapshot.id, sessionSnapshot.data()) : null; const candidate = candidateSnapshot.exists ? parsePersistedCandidate(candidateSnapshot.id, candidateSnapshot.data()) : null;
      if (!currentSession || !candidate || candidate.sessionId !== currentSession.id || candidate.companyId !== currentSession.companyId || candidate.projectId !== currentSession.projectId || candidate.organizationUnitId !== currentSession.organizationUnitId) throw new GuidedAccessError("Candidate relationship is invalid.", 409);
      if (!currentSession.active || currentSession.status !== "active") throw new GuidedAccessError("Session is not editable.", 409);
      if (candidate.status === "converted") throw new GuidedAccessError("Converted candidates are immutable.", 409);
      const canonical = await requireSessionWriteContext(transaction, actor, currentSession); const changes: Record<string, unknown> = {}; const action = String(body.action);
      if (action === "refine") { if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 200 || body.sourceText !== undefined && (typeof body.sourceText !== "string" || body.sourceText.length > 2000)) throw new GuidedAccessError("Invalid candidate text.", 400); changes.label = body.label.trim(); if (body.sourceText !== undefined) changes.sourceText = body.sourceText.trim(); changes.status = "refining"; changes.active = true; }
      if (action === "classify") { if (typeof body.classification !== "string" || !CANDIDATE_CLASSIFICATIONS.includes(body.classification as never) || body.classification === "unclassified") throw new GuidedAccessError("Invalid candidate classification.", 400); const snapshots = await transaction.get(adminDb.collection("guidedAnswers").where("candidateId", "==", candidate.id).limit(MAX_GUIDED_ANSWERS_PER_CANDIDATE + 1)); if (snapshots.size > MAX_GUIDED_ANSWERS_PER_CANDIDATE) throw new GuidedAccessError("Guided answer limit exceeded.", 409); const answered = new Set(snapshots.docs.flatMap((document) => { const answer = parsePersistedAnswer(document.id, document.data()); return answer && answer.active && answer.companyId === currentSession.companyId && answer.projectId === currentSession.projectId && answer.organizationUnitId === currentSession.organizationUnitId && answer.sessionId === currentSession.id && answer.candidateId === candidate.id && answer.subjectType === "candidate" && answer.questionId.startsWith("classification.") ? [answer.questionId] : []; })); const required = [...QUESTION_REGISTRY.values()].filter((question) => question.stage === "candidate_classification").map((question) => question.id); if (required.some((questionId) => !answered.has(questionId))) throw new GuidedAccessError("Complete the classification interview before confirming a classification.", 409); changes.classification = body.classification; changes.status = "refining"; changes.active = true; if ((body.classification === "duplicate" || body.classification === "step") && (typeof body.relatedCandidateId !== "string" || !isValidFirestoreDocumentId(body.relatedCandidateId))) throw new GuidedAccessError("A related candidate is required.", 400); if (typeof body.relatedCandidateId === "string") { const related = await transaction.get(adminDb.collection("procedureCandidates").doc(body.relatedCandidateId)); const parsed = related.exists ? parsePersistedCandidate(related.id, related.data()) : null; if (!parsed || parsed.sessionId !== currentSession.id || parsed.companyId !== currentSession.companyId || parsed.projectId !== currentSession.projectId || parsed.organizationUnitId !== currentSession.organizationUnitId || parsed.id === candidate.id) throw new GuidedAccessError("Related candidate is invalid.", 409); changes.relatedCandidateId = parsed.id; } }
      if (action === "exclude") { if (!["task", "step", "duplicate", "unclear"].includes(candidate.classification) || typeof body.exclusionReason !== "string" || !body.exclusionReason.trim() || body.exclusionReason.length > 2000) throw new GuidedAccessError("A valid exclusion reason and classification are required.", 400); changes.status = "excluded"; changes.exclusionReason = body.exclusionReason.trim(); changes.active = false; }
      if (action === "confirm_procedure") { if (candidate.classification !== "procedure" || !["discovered", "refining"].includes(candidate.status)) throw new GuidedAccessError("Only a procedure-classified candidate can be confirmed.", 409); changes.status = "confirmed_procedure"; }
      const now = FieldValue.serverTimestamp(); transaction.update(candidateRef, { ...changes, updatedBy: companyUserActorPath(canonical.id), updatedAt: now }); transaction.update(sessionSnapshot.ref, { currentCandidateId: candidate.id, updatedBy: companyUserActorPath(canonical.id), updatedAt: now, lastActivityAt: now });
    });
    return NextResponse.json({ success: true });
  } catch (error) { return guidedError(error); }
}
