import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { GuidedAccessError, requireGuidedActor, requireSessionAccess, requireSessionWriteContext, validateSubject } from "@/lib/guided-authorization";
import { DISCOVERY_PROMPT_SET_VERSION, GUIDED_ENGINE_VERSION, findConflictingV2Session, guidedAnswerDocumentId, isResumableV2Session, parsePersistedAnswer, parsePersistedCandidate, parsePersistedSession, parseSessionCreate } from "@/lib/guided-documentation";
import { exactQuery, guidedError } from "@/lib/guided-store";
import { isValidFirestoreDocumentId, readJsonObject } from "@/lib/request-validation";
import { companyUserActorPath } from "@/lib/tenant-model";
import { traceGuidedOperation } from "@/lib/guided-observability";

const transitions = {
  pause: { status: "paused" }, resume: { status: "active" },
  complete_discovery: { phase: "classification" }, begin_documentation: { phase: "documentation" },
  complete: { phase: "completed", status: "completed", active: false }, abandon: { status: "abandoned", active: false },
} as const;

export async function GET(request: Request) {
  try {
    const actor = await requireGuidedActor(); const params = new URL(request.url).searchParams;
    if (exactQuery(params, ["sessionId"])) {
      const sessionId = params.get("sessionId"); if (!sessionId || !isValidFirestoreDocumentId(sessionId)) throw new GuidedAccessError("Invalid session.", 400);
      const session = await requireSessionAccess(sessionId, actor);
      if (session.engineVersion !== GUIDED_ENGINE_VERSION) return NextResponse.json({ success: true, session, legacy: true });
      const nameId = guidedAnswerDocumentId(session.id, session.id, "procedure.name", session.id);
      const nameSnapshot = nameId ? await adminDb.collection("guidedAnswers").doc(nameId).get() : null;
      const name = nameSnapshot?.exists ? parsePersistedAnswer(nameSnapshot.id, nameSnapshot.data()) : null;
      return NextResponse.json({ success: true, session, procedureName: name?.answer.kind === "text" ? name.answer.value : "" });
    }
    if (!exactQuery(params, ["projectId"])) throw new GuidedAccessError("A valid project query is required.", 400);
    const projectId = params.get("projectId"); if (!projectId || !isValidFirestoreDocumentId(projectId)) throw new GuidedAccessError("Invalid project.", 400);
    const snapshot = await adminDb.collection("documentationSessions").where("projectId", "==", projectId).limit(101).get();
    const parsed = snapshot.docs.slice(0, 100).flatMap((document) => { const session = parsePersistedSession(document.id, document.data()); return session && session.companyId === actor.companyId && session.projectId === projectId ? [session] : []; });
    const checks = await Promise.allSettled(parsed.map((session) => requireSessionAccess(session.id, actor)));
    const resumable = checks.flatMap((result) => result.status === "fulfilled" && isResumableV2Session(result.value) ? [result.value] : []);
    const sessions = await Promise.all(resumable.map(async (session) => { const nameId = guidedAnswerDocumentId(session.id, session.id, "procedure.name", session.id); const snap = nameId ? await adminDb.collection("guidedAnswers").doc(nameId).get() : null; const answer = snap?.exists ? parsePersistedAnswer(snap.id, snap.data()) : null; return { ...session, procedureName: answer?.answer.kind === "text" ? answer.answer.value : "إجراء غير مكتمل" }; }));
    return NextResponse.json({ success: true, sessions, truncated: snapshot.size > 100, limit: 100 });
  } catch (error) { return guidedError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireGuidedActor(); const input = parseSessionCreate(await readJsonObject(request));
    if (!input) throw new GuidedAccessError("Invalid documentation session request.", 400);
    const { procedureName, ...scope } = input; const ref = adminDb.collection("documentationSessions").doc();
    const result = await adminDb.runTransaction(async (transaction) => {
      const proposed = { id: ref.id, ...scope, phase: "documentation" as const, status: "active" as const, engineVersion: GUIDED_ENGINE_VERSION, discoveryPromptSetVersion: DISCOVERY_PROMPT_SET_VERSION, active: true, createdBy: companyUserActorPath(actor.id), updatedBy: companyUserActorPath(actor.id) };
      const canonical = await requireSessionWriteContext(transaction, actor, proposed);
      await validateSubject(transaction, canonical, input.companyId, input.projectId, input.organizationUnitId, input.subjectType, input.subjectUserId);
      const existingSnapshot = await transaction.get(adminDb.collection("documentationSessions").where("projectId", "==", input.projectId).limit(101));
      if (existingSnapshot.size > 100) throw new GuidedAccessError("Documentation session limit exceeded.", 409);
      const sameScopeSessions = existingSnapshot.docs.flatMap((document) => {
        const session = parsePersistedSession(document.id, document.data());
        return session && isResumableV2Session(session) && session.companyId === scope.companyId && session.projectId === scope.projectId && session.organizationUnitId === scope.organizationUnitId && session.subjectType === scope.subjectType && session.subjectUserId === scope.subjectUserId ? [session] : [];
      });
      const namedSessions: Array<{ session: (typeof sameScopeSessions)[number]; procedureName?: string }> = [];
      for (const session of sameScopeSessions) {
        const nameId = guidedAnswerDocumentId(session.id, session.id, "procedure.name", session.id);
        const nameSnapshot = nameId ? await transaction.get(adminDb.collection("guidedAnswers").doc(nameId)) : null;
        const name = nameSnapshot?.exists ? parsePersistedAnswer(nameSnapshot.id, nameSnapshot.data()) : null;
        const validName = name && name.sessionId === session.id && name.companyId === session.companyId && name.projectId === session.projectId && name.organizationUnitId === session.organizationUnitId && name.subjectType === "candidate" && name.subjectKey === session.id && name.candidateId === session.id && name.questionId === "procedure.name" && name.ruleId === "procedure.name.required.v1" && name.active && name.answer.kind === "text" ? name.answer.value : undefined;
        if (validName === undefined) throw new GuidedAccessError("Existing procedure name evidence is invalid.", 409);
        namedSessions.push({ session, procedureName: validName });
      }
      const existing = findConflictingV2Session(namedSessions, scope, procedureName);
      if (existing) return { sessionId: existing.id, existing: true };
      const actorPath = companyUserActorPath(canonical.id); const now = FieldValue.serverTimestamp();
      transaction.create(ref, { ...scope, phase: "documentation", status: "active", engineVersion: GUIDED_ENGINE_VERSION, discoveryPromptSetVersion: DISCOVERY_PROMPT_SET_VERSION, active: true, createdBy: actorPath, updatedBy: actorPath, createdAt: now, updatedAt: now, lastActivityAt: now });
      const nameId = guidedAnswerDocumentId(ref.id, ref.id, "procedure.name", ref.id); if (!nameId) throw new GuidedAccessError("Procedure name identity is invalid.", 400);
      transaction.create(adminDb.collection("guidedAnswers").doc(nameId), { companyId: input.companyId, projectId: input.projectId, organizationUnitId: input.organizationUnitId, sessionId: ref.id, subjectType: "candidate", subjectKey: ref.id, questionId: "procedure.name", ruleId: "procedure.name.required.v1", answer: { kind: "text", value: procedureName }, certainty: "confirmed", active: true, answeredBy: actorPath, candidateId: ref.id, createdAt: now, updatedAt: now });
      return { sessionId: ref.id, existing: false };
    });
    traceGuidedOperation({ operation: result.existing ? "guided-session.resume-existing" : "guided-session.create-v2", queries: 1, writesAtLeast: result.existing ? 0 : 2 });
    return NextResponse.json({ success: true, ...result }, { status: result.existing ? 200 : 201 });
  } catch (error) { return guidedError(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireGuidedActor(); const body = await readJsonObject(request);
    if (!body || Object.keys(body).some((key) => !["sessionId", "action", "abandonedReason"].includes(key)) || typeof body.sessionId !== "string" || !isValidFirestoreDocumentId(body.sessionId) || typeof body.action !== "string" || !(body.action in transitions)) throw new GuidedAccessError("Invalid session transition.", 400);
    const sessionId = body.sessionId as string; const requestedAction = body.action as keyof typeof transitions;
    const session = await requireSessionAccess(sessionId, actor); const ref = adminDb.collection("documentationSessions").doc(session.id);
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref); const current = snapshot.exists ? parsePersistedSession(snapshot.id, snapshot.data()) : null;
      if (!current || current.status === "completed" || current.status === "abandoned") throw new GuidedAccessError("Session cannot transition from its current state.", 409);
      const canonical = await requireSessionWriteContext(transaction, actor, current); const action = requestedAction;
      if (action === "resume" && current.status !== "paused" || action === "pause" && current.status !== "active" || action === "complete_discovery" && current.phase !== "discovery" || action === "begin_documentation" && current.phase !== "classification" || action === "complete" && !["classification", "confirmation"].includes(current.phase)) throw new GuidedAccessError("Invalid session transition.", 409);
      if (action === "complete_discovery") { const answerId = guidedAnswerDocumentId(current.id, current.id, "discovery.complete"); const answerSnapshot = answerId ? await transaction.get(adminDb.collection("guidedAnswers").doc(answerId)) : null; const answer = answerSnapshot?.exists ? parsePersistedAnswer(answerSnapshot.id, answerSnapshot.data()) : null; if (!answer || answer.certainty !== "confirmed" || answer.answer.kind !== "boolean" || answer.answer.value !== true) throw new GuidedAccessError("Explicit discovery completion confirmation is required.", 409); }
      if (action === "begin_documentation" || action === "complete") { const candidates = await transaction.get(adminDb.collection("procedureCandidates").where("sessionId", "==", current.id).limit(101)); if (candidates.size > 100) throw new GuidedAccessError("Candidate limit exceeded.", 409); const parsed = candidates.docs.map((document) => parsePersistedCandidate(document.id, document.data())); if (parsed.some((candidate) => !candidate || candidate.companyId !== current.companyId || candidate.projectId !== current.projectId || candidate.organizationUnitId !== current.organizationUnitId)) throw new GuidedAccessError("Candidate relationship is invalid.", 409); if (action === "begin_documentation" && (!parsed.some((candidate) => candidate?.status === "confirmed_procedure") || parsed.some((candidate) => candidate && !["confirmed_procedure", "excluded"].includes(candidate.status)))) throw new GuidedAccessError("Every candidate requires classification and at least one confirmed procedure is required.", 409); if (action === "complete" && parsed.some((candidate) => candidate && !["converted", "excluded"].includes(candidate.status))) throw new GuidedAccessError("All candidates require a final disposition.", 409); }
      const changes: Record<string, unknown> = { ...transitions[action], updatedBy: companyUserActorPath(canonical.id), updatedAt: FieldValue.serverTimestamp(), lastActivityAt: FieldValue.serverTimestamp() };
      if (action === "complete_discovery") changes.discoveryCompletedAt = FieldValue.serverTimestamp();
      if (action === "complete") changes.completedAt = FieldValue.serverTimestamp();
      if (action === "abandon") { if (typeof body.abandonedReason !== "string" || !body.abandonedReason.trim() || body.abandonedReason.length > 2000) throw new GuidedAccessError("An abandonment reason is required.", 400); changes.abandonedReason = body.abandonedReason.trim(); }
      transaction.update(ref, changes);
    });
    return NextResponse.json({ success: true });
  } catch (error) { return guidedError(error); }
}
