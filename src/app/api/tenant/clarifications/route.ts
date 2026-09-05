import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { GuidedAccessError, requireGuidedActor, requireSessionAccess, requireSessionWriteContext } from "@/lib/guided-authorization";
import { parsePersistedCandidate, parsePersistedClarification, parsePersistedSession } from "@/lib/guided-documentation";
import { exactQuery, guidedError, loadCandidate, loadClarifications } from "@/lib/guided-store";
import { isValidFirestoreDocumentId, readJsonObject } from "@/lib/request-validation";
import { companyUserActorPath } from "@/lib/tenant-model";

export async function GET(request: Request) {
  try {
    const actor = await requireGuidedActor(); const params = new URL(request.url).searchParams;
    if (!exactQuery(params, ["sessionId"], ["candidateId"])) throw new GuidedAccessError("Invalid clarification query.", 400);
    const sessionId = params.get("sessionId"); const candidateId = params.get("candidateId");
    if (!sessionId || !isValidFirestoreDocumentId(sessionId) || candidateId && !isValidFirestoreDocumentId(candidateId)) throw new GuidedAccessError("Invalid clarification scope.", 400);
    const session = await requireSessionAccess(sessionId, actor); if (candidateId) await loadCandidate(session, candidateId); const result = await loadClarifications(session, candidateId ?? undefined);
    return NextResponse.json({ success: true, ...result, limit: 200 });
  } catch (error) { return guidedError(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireGuidedActor(); const body = await readJsonObject(request);
    if (!body || Object.keys(body).some((key) => !["sessionId", "clarificationId", "action", "resolutionNote"].includes(key)) || typeof body.sessionId !== "string" || !isValidFirestoreDocumentId(body.sessionId) || typeof body.clarificationId !== "string" || !isValidFirestoreDocumentId(body.clarificationId) || body.action !== "dismiss" || typeof body.resolutionNote !== "string" || !body.resolutionNote.trim() || body.resolutionNote.length > 2000) throw new GuidedAccessError("Invalid clarification update.", 400);
    const sessionId = body.sessionId; const clarificationId = body.clarificationId; const resolutionNote = body.resolutionNote;
    const session = await requireSessionAccess(sessionId, actor); const clarificationRef = adminDb.collection("clarificationItems").doc(clarificationId);
    await adminDb.runTransaction(async (transaction) => {
      const [sessionSnapshot, clarificationSnapshot] = await Promise.all([transaction.get(adminDb.collection("documentationSessions").doc(session.id)), transaction.get(clarificationRef)]);
      const currentSession = sessionSnapshot.exists ? parsePersistedSession(sessionSnapshot.id, sessionSnapshot.data()) : null; const clarification = clarificationSnapshot.exists ? parsePersistedClarification(clarificationSnapshot.id, clarificationSnapshot.data()) : null;
      if (!currentSession || !clarification || clarification.sessionId !== currentSession.id || clarification.companyId !== currentSession.companyId || clarification.projectId !== currentSession.projectId || clarification.organizationUnitId !== currentSession.organizationUnitId) throw new GuidedAccessError("Clarification relationship is invalid.", 409);
      if (!currentSession.active || currentSession.status !== "active") throw new GuidedAccessError("Session is not editable.", 409);
      if (clarification.status !== "open" || clarification.severity !== "recommended") throw new GuidedAccessError("Only open recommended clarifications may be dismissed.", 409);
      if (clarification.candidateId) { const snapshot = await transaction.get(adminDb.collection("procedureCandidates").doc(clarification.candidateId)); const candidate = snapshot.exists ? parsePersistedCandidate(snapshot.id, snapshot.data()) : null; if (!candidate || candidate.sessionId !== currentSession.id || candidate.status === "converted") throw new GuidedAccessError("Converted clarification history is immutable.", 409); }
      const canonical = await requireSessionWriteContext(transaction, actor, currentSession); const now = FieldValue.serverTimestamp(); const actorPath = companyUserActorPath(canonical.id);
      transaction.update(clarificationRef, { status: "dismissed", active: false, resolutionNote: resolutionNote.trim(), resolvedAt: now, updatedBy: actorPath, updatedAt: now });
      transaction.update(sessionSnapshot.ref, { updatedBy: actorPath, updatedAt: now, lastActivityAt: now });
    });
    return NextResponse.json({ success: true });
  } catch (error) { return guidedError(error); }
}
