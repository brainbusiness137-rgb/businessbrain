import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { GuidedAccessError } from "@/lib/guided-authorization";
import { DocumentationSession, GuidedAnswer, ProcedureCandidate, parsePersistedAnswer, parsePersistedCandidate, parsePersistedClarification } from "@/lib/guided-documentation";
import { ProcedureAccessError } from "@/lib/procedure-authorization";
import { TenantAccessError } from "@/lib/tenant-auth";

export const MAX_GUIDED_ANSWERS_PER_CANDIDATE = 2_100;

export function guidedError(error: unknown) {
  if (error instanceof GuidedAccessError || error instanceof ProcedureAccessError || error instanceof TenantAccessError) return NextResponse.json({ success: false, message: error.message }, { status: error.status });
  console.error("Guided documentation operation failed:", error);
  return NextResponse.json({ success: false, message: "Guided documentation operation failed." }, { status: 500 });
}
export function exactQuery(params: URLSearchParams, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return [...params.keys()].every((key) => allowed.has(key)) && required.every((key) => params.getAll(key).length === 1) && optional.every((key) => params.getAll(key).length <= 1);
}
export async function loadCandidates(session: DocumentationSession, limit = 100) {
  const snapshot = await adminDb.collection("procedureCandidates").where("sessionId", "==", session.id).limit(limit + 1).get();
  return { candidates: snapshot.docs.slice(0, limit).flatMap((document) => { const candidate = parsePersistedCandidate(document.id, document.data()); return candidate && candidate.companyId === session.companyId && candidate.projectId === session.projectId && candidate.organizationUnitId === session.organizationUnitId && candidate.sessionId === session.id ? [candidate] : []; }), truncated: snapshot.size > limit };
}
export async function loadCandidate(session: DocumentationSession, candidateId: string): Promise<ProcedureCandidate> {
  const snapshot = await adminDb.collection("procedureCandidates").doc(candidateId).get();
  const candidate = snapshot.exists ? parsePersistedCandidate(snapshot.id, snapshot.data()) : null;
  if (!candidate || candidate.sessionId !== session.id || candidate.companyId !== session.companyId || candidate.projectId !== session.projectId || candidate.organizationUnitId !== session.organizationUnitId) throw new GuidedAccessError("Procedure candidate not found.", 404);
  return candidate;
}
export async function loadAnswers(session: DocumentationSession, candidateId?: string): Promise<GuidedAnswer[]> {
  const query: FirebaseFirestore.Query = candidateId ? adminDb.collection("guidedAnswers").where("candidateId", "==", candidateId) : adminDb.collection("guidedAnswers").where("sessionId", "==", session.id);
  const limit = candidateId ? MAX_GUIDED_ANSWERS_PER_CANDIDATE : 100;
  const snapshot = await query.limit(limit + 1).get();
  if (snapshot.size > limit) throw new GuidedAccessError("Guided answer limit exceeded.", 409);
  return snapshot.docs.flatMap((document) => { const answer = parsePersistedAnswer(document.id, document.data()); return answer && answer.active && answer.companyId === session.companyId && answer.projectId === session.projectId && answer.organizationUnitId === session.organizationUnitId && answer.sessionId === session.id && (!candidateId || answer.candidateId === candidateId) ? [answer] : []; });
}
export async function loadClarifications(session: DocumentationSession, candidateId?: string) {
  const query: FirebaseFirestore.Query = candidateId ? adminDb.collection("clarificationItems").where("candidateId", "==", candidateId) : adminDb.collection("clarificationItems").where("sessionId", "==", session.id);
  const snapshot = await query.limit(201).get();
  return { clarifications: snapshot.docs.slice(0, 200).flatMap((document) => { const item = parsePersistedClarification(document.id, document.data()); return item && item.companyId === session.companyId && item.projectId === session.projectId && item.organizationUnitId === session.organizationUnitId && item.sessionId === session.id && (!candidateId || item.candidateId === candidateId) ? [item] : []; }), truncated: snapshot.size > 200 };
}
