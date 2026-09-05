import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { GuidedAccessError, requireGuidedActor, requireSessionAccess, requireSessionWriteContext, validateSubject } from "@/lib/guided-authorization";
import { DISCOVERY_PROMPT_SET_VERSION, GUIDED_ENGINE_VERSION, guidedAnswerDocumentId, parsePersistedAnswer, parsePersistedCandidate, parsePersistedSession, parseSessionCreate } from "@/lib/guided-documentation";
import { exactQuery, guidedError } from "@/lib/guided-store";
import { isValidFirestoreDocumentId, readJsonObject } from "@/lib/request-validation";
import { companyUserActorPath } from "@/lib/tenant-model";

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
      return NextResponse.json({ success: true, session: await requireSessionAccess(sessionId, actor) });
    }
    if (!exactQuery(params, ["projectId"])) throw new GuidedAccessError("A valid project query is required.", 400);
    const projectId = params.get("projectId"); if (!projectId || !isValidFirestoreDocumentId(projectId)) throw new GuidedAccessError("Invalid project.", 400);
    const snapshot = await adminDb.collection("documentationSessions").where("projectId", "==", projectId).limit(101).get();
    const parsed = snapshot.docs.slice(0, 100).flatMap((document) => { const session = parsePersistedSession(document.id, document.data()); return session && session.companyId === actor.companyId && session.projectId === projectId ? [session] : []; });
    const checks = await Promise.allSettled(parsed.map((session) => requireSessionAccess(session.id, actor)));
    return NextResponse.json({ success: true, sessions: checks.flatMap((result) => result.status === "fulfilled" ? [result.value] : []), truncated: snapshot.size > 100, limit: 100 });
  } catch (error) { return guidedError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireGuidedActor(); const input = parseSessionCreate(await readJsonObject(request));
    if (!input) throw new GuidedAccessError("Invalid documentation session request.", 400);
    const ref = adminDb.collection("documentationSessions").doc();
    await adminDb.runTransaction(async (transaction) => {
      const canonical = await requireSessionWriteContext(transaction, actor, { id: ref.id, ...input, phase: "discovery", status: "active", engineVersion: GUIDED_ENGINE_VERSION, discoveryPromptSetVersion: DISCOVERY_PROMPT_SET_VERSION, active: true, createdBy: companyUserActorPath(actor.id), updatedBy: companyUserActorPath(actor.id) });
      await validateSubject(transaction, canonical, input.companyId, input.projectId, input.organizationUnitId, input.subjectType, input.subjectUserId);
      const actorPath = companyUserActorPath(canonical.id); const now = FieldValue.serverTimestamp();
      transaction.create(ref, { ...input, phase: "discovery", status: "active", engineVersion: GUIDED_ENGINE_VERSION, discoveryPromptSetVersion: DISCOVERY_PROMPT_SET_VERSION, active: true, createdBy: actorPath, updatedBy: actorPath, createdAt: now, updatedAt: now, lastActivityAt: now });
    });
    return NextResponse.json({ success: true, sessionId: ref.id }, { status: 201 });
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
