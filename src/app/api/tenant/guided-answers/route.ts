import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { GuidedAccessError, requireGuidedActor, requireSessionAccess, requireSessionWriteContext } from "@/lib/guided-authorization";
import { guidedAnswerDocumentId, parseAnswerSubmission, parsePersistedAnswer, parsePersistedCandidate, parsePersistedClarification, parsePersistedSession } from "@/lib/guided-documentation";
import { QUESTION_REGISTRY, isQuestionApplicable, nextQuestion, nextQuestionForStages, nextV2State, publicQuestion, validateQuestionAnswer } from "@/lib/guided-question-registry";
import { MAX_GUIDED_ANSWERS_PER_CANDIDATE, guidedError, loadAnswers } from "@/lib/guided-store";
import { isValidFirestoreDocumentId, readJsonObject } from "@/lib/request-validation";
import { parsePersistedOrganizationUnit } from "@/lib/organization-units";
import { parsePersistedCompanyUser } from "@/lib/tenant-auth";
import { companyUserActorPath } from "@/lib/tenant-model";
import { traceGuidedOperation } from "@/lib/guided-observability";

export async function GET(request: Request) {
  try {
    const actor = await requireGuidedActor(); const params = new URL(request.url).searchParams;
    const keys = [...params.keys()]; if (keys.some((key) => !["sessionId", "candidateId"].includes(key)) || params.getAll("sessionId").length !== 1 || params.getAll("candidateId").length > 1) throw new GuidedAccessError("Invalid guided-answer query.", 400);
    const sessionId = params.get("sessionId"); const candidateId = params.get("candidateId");
    if (!sessionId || !isValidFirestoreDocumentId(sessionId) || candidateId && !isValidFirestoreDocumentId(candidateId)) throw new GuidedAccessError("Invalid guided-answer scope.", 400);
    const session = await requireSessionAccess(sessionId, actor); if (candidateId) { const snapshot = await adminDb.collection("procedureCandidates").doc(candidateId).get(); const candidate = snapshot.exists ? parsePersistedCandidate(snapshot.id, snapshot.data()) : null; if (!candidate || candidate.sessionId !== session.id || candidate.companyId !== session.companyId || candidate.projectId !== session.projectId || candidate.organizationUnitId !== session.organizationUnitId) throw new GuidedAccessError("Candidate relationship is invalid.", 404); }
    return NextResponse.json({ success: true, answers: await loadAnswers(session, candidateId ?? undefined), limit: candidateId ? MAX_GUIDED_ANSWERS_PER_CANDIDATE : 100 });
  } catch (error) { return guidedError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireGuidedActor(); const input = parseAnswerSubmission(await readJsonObject(request));
    if (!input) throw new GuidedAccessError("Invalid guided answer.", 400);
    const session = await requireSessionAccess(input.sessionId, actor); const question = QUESTION_REGISTRY.get(input.questionId);
    if (!question || question.subjectType !== input.subjectType) throw new GuidedAccessError("Unknown or mismatched question.", 400);
    const uncertaintyOnly = input.certainty === "unknown" || input.certainty === "needs_check";
    if (!uncertaintyOnly && !validateQuestionAnswer(question, input.answer)) throw new GuidedAccessError("Answer does not match the question contract.", 400);
    const effectiveCandidateId = session.engineVersion === "guided-v2" ? session.id : input.candidateId;
    const answerId = guidedAnswerDocumentId(session.id, input.subjectKey, input.questionId, effectiveCandidateId); if (!answerId) throw new GuidedAccessError("Answer identity is invalid.", 400);
    const answerRef = adminDb.collection("guidedAnswers").doc(answerId);
    const updatedAnswers = await adminDb.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(adminDb.collection("documentationSessions").doc(session.id)); const currentSession = sessionSnapshot.exists ? parsePersistedSession(sessionSnapshot.id, sessionSnapshot.data()) : null;
      if (!currentSession || !currentSession.active || currentSession.status !== "active") throw new GuidedAccessError("Session is not editable.", 409);
      const canonical = await requireSessionWriteContext(transaction, actor, currentSession);
      let candidate = null;
      const v2 = currentSession.engineVersion === "guided-v2";
      if (input.candidateId) { const snapshot = await transaction.get(adminDb.collection("procedureCandidates").doc(input.candidateId)); candidate = snapshot.exists ? parsePersistedCandidate(snapshot.id, snapshot.data()) : null; if (!candidate || candidate.status === "converted" || candidate.sessionId !== currentSession.id || candidate.companyId !== currentSession.companyId || candidate.projectId !== currentSession.projectId || candidate.organizationUnitId !== currentSession.organizationUnitId) throw new GuidedAccessError("Candidate is missing, immutable, or out of scope.", 409); }
      if (v2 && input.candidateId || input.subjectType === "session" && input.subjectKey !== currentSession.id || input.subjectType === "candidate" && input.subjectKey !== (v2 ? currentSession.id : candidate?.id) || input.subjectType === "step" && input.stepKey !== input.subjectKey) throw new GuidedAccessError("Answer subject is invalid.", 409);
      const answerQuery: FirebaseFirestore.Query = candidate ? adminDb.collection("guidedAnswers").where("candidateId", "==", candidate.id) : adminDb.collection("guidedAnswers").where("sessionId", "==", currentSession.id);
      const answerLimit = candidate || v2 ? MAX_GUIDED_ANSWERS_PER_CANDIDATE : 100;
      const answerSnapshots = await transaction.get(answerQuery.limit(answerLimit + 1));
      if (answerSnapshots.size > answerLimit) throw new GuidedAccessError("Guided answer limit exceeded.", 409);
      const canonicalAnswers = answerSnapshots.docs.flatMap((document) => { const parsed = parsePersistedAnswer(document.id, document.data()); return parsed && parsed.active && parsed.companyId === currentSession.companyId && parsed.projectId === currentSession.projectId && parsed.organizationUnitId === currentSession.organizationUnitId && parsed.sessionId === currentSession.id ? [parsed] : []; });
      const previous = canonicalAnswers.find((entry) => entry.id === answerId);
      if (!previous && (question.stage === "discovery_context" && currentSession.phase !== "discovery" || question.stage === "candidate_classification" && currentSession.phase !== "classification" || !["discovery_context", "candidate_classification"].includes(question.stage) && !["documentation", "confirmation"].includes(currentSession.phase))) throw new GuidedAccessError("Question is not valid in the current session phase.", 409);
      const stages = input.subjectType === "session" ? ["discovery_context"] as const : input.subjectType === "step" ? ["step_core", "step_resources", "step_controls"] as const : candidate && ["discovered", "refining"].includes(candidate.status) ? ["candidate_classification"] as const : question.stage === "procedure_outputs" ? ["procedure_outputs"] as const : question.stage === "confirmation" ? ["confirmation"] as const : ["procedure_basics", "procedure_inputs"] as const;
      const expected = nextQuestionForStages(canonicalAnswers, input.subjectKey, input.subjectType, stages);
      if (question.stage === "procedure_outputs" || question.stage === "confirmation") {
        const stepKeys = [...new Set(canonicalAnswers.filter((entry) => entry.subjectType === "step" && entry.stepKey).map((entry) => entry.stepKey as string))].sort();
        const lastKey = stepKeys.at(-1); const ended = canonicalAnswers.find((entry) => entry.subjectKey === lastKey && entry.questionId === "step.continue")?.answer;
        const basicsPending = nextQuestionForStages(canonicalAnswers, candidate?.id ?? currentSession.id, "candidate", ["procedure_basics", "procedure_inputs"]);
        if (!lastKey || basicsPending || ended?.kind !== "boolean" || ended.value !== false) throw new GuidedAccessError("Procedure steps must be completed first.", 409);
        if (question.stage === "confirmation" && nextQuestionForStages(canonicalAnswers, candidate!.id, "candidate", ["procedure_outputs"])) throw new GuidedAccessError("Procedure outputs must be completed first.", 409);
      }
      if ((!previous && (!expected || expected.id !== question.id)) || !isQuestionApplicable(question, canonicalAnswers, input.subjectKey)) throw new GuidedAccessError("The submitted question is not the authoritative next question.", 409);
      if (input.subjectType === "step") {
        const keys = [...new Set(canonicalAnswers.filter((entry) => entry.subjectType === "step" && entry.stepKey).map((entry) => entry.stepKey as string))].sort();
        if (!keys.includes(input.subjectKey)) { const expectedSequence = keys.length + 1; const validKey = new RegExp(`^s${String(expectedSequence).padStart(3, "0")}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(input.subjectKey); const priorContinue = keys.length ? canonicalAnswers.find((entry) => entry.subjectKey === keys.at(-1) && entry.questionId === "step.continue")?.answer : null; if (keys.length >= 100 || !validKey || keys.length > 0 && (priorContinue?.kind !== "boolean" || priorContinue.value !== true)) throw new GuidedAccessError("Temporary step creation is not currently allowed.", 409); }
      }
      if (input.answer.kind === "reference" && !uncertaintyOnly) {
        const collection = input.answer.referenceType === "user" ? "users" : "organizationUnits"; const snapshot = await transaction.get(adminDb.collection(collection).doc(input.answer.referenceId));
        if (input.answer.referenceType === "user") { const user = snapshot.exists ? parsePersistedCompanyUser(snapshot.id, snapshot.data()) : null; if (!user || !user.active || user.companyId !== currentSession.companyId) throw new GuidedAccessError("Referenced user is invalid.", 409); }
        else { const unit = snapshot.exists ? parsePersistedOrganizationUnit(snapshot.id, snapshot.data()) : null; if (!unit || !unit.active || unit.companyId !== currentSession.companyId) throw new GuidedAccessError("Referenced unit is invalid.", 409); }
      }
      const existingSnapshot = await transaction.get(answerRef); const existing = existingSnapshot.exists ? parsePersistedAnswer(existingSnapshot.id, existingSnapshot.data()) : null;
      if (existing && (existing.sessionId !== currentSession.id || existing.candidateId !== effectiveCandidateId)) throw new GuidedAccessError("Answer identity collision.", 409);
      const obsoleteQuestions: string[] = [];
      if (input.answer.kind === "boolean" && input.answer.value === false) { if (input.questionId === "step.review.required") obsoleteQuestions.push("step.review.performer"); if (input.questionId === "step.approval.required") obsoleteQuestions.push("step.approval.performer", "step.approval.condition"); if (input.questionId === "step.decision.is_decision") obsoleteQuestions.push("step.decision.question"); }
      if (input.questionId === "step.performer.type" && input.answer.kind === "choice") { if (input.answer.value === "user") obsoleteQuestions.push("step.performer.role"); else if (["role", "external", "other"].includes(input.answer.value)) obsoleteQuestions.push("step.performer.user"); else obsoleteQuestions.push("step.performer.user", "step.performer.role"); }
      const obsoleteSnapshots = [] as FirebaseFirestore.QuerySnapshot[];
      for (const questionId of obsoleteQuestions) { const obsoleteAnswerId = guidedAnswerDocumentId(currentSession.id, input.subjectKey, questionId, effectiveCandidateId); if (obsoleteAnswerId) obsoleteSnapshots.push(await transaction.get(adminDb.collection("clarificationItems").where("answerId", "==", obsoleteAnswerId).limit(2))); }
      const clarificationSnapshot = await transaction.get(adminDb.collection("clarificationItems").where("answerId", "==", answerId).limit(2)); const clarificationDoc = clarificationSnapshot.docs[0]; const actorPath = companyUserActorPath(canonical.id); const now = FieldValue.serverTimestamp();
      const answerData = { companyId: currentSession.companyId, projectId: currentSession.projectId, organizationUnitId: currentSession.organizationUnitId, sessionId: currentSession.id, subjectType: input.subjectType, subjectKey: input.subjectKey, questionId: input.questionId, ruleId: question.ruleId, answer: input.answer, certainty: input.certainty, active: true, answeredBy: actorPath, ...(effectiveCandidateId ? { candidateId: effectiveCandidateId } : {}), ...(input.stepKey ? { stepKey: input.stepKey } : {}), ...(input.uncertaintyNote ? { uncertaintyNote: input.uncertaintyNote } : {}), updatedAt: now };
      if (existingSnapshot.exists) transaction.update(answerRef, { ...answerData, ...(!input.uncertaintyNote ? { uncertaintyNote: FieldValue.delete() } : {}) }); else transaction.create(answerRef, { ...answerData, createdAt: now });
      if (input.certainty !== "confirmed") { const category = input.certainty; const losesCanonicalMeaning = input.subjectType !== "session" && question.stage !== "candidate_classification"; const severity = input.certainty === "unknown" || input.certainty === "needs_check" || losesCanonicalMeaning ? "required" : "recommended"; const data = { companyId: currentSession.companyId, projectId: currentSession.projectId, organizationUnitId: currentSession.organizationUnitId, sessionId: currentSession.id, subjectType: input.subjectType, subjectKey: input.subjectKey, questionId: input.questionId, category, severity, summary: input.uncertaintyNote || `تحتاج إجابة ${question.promptAr} إلى توضيح.`, status: "open", active: true, answerId, ...(effectiveCandidateId ? { candidateId: effectiveCandidateId } : {}), ...(input.stepKey ? { stepKey: input.stepKey } : {}), updatedBy: actorPath, updatedAt: now }; if (clarificationDoc) transaction.update(clarificationDoc.ref, { ...data, resolutionAnswerId: FieldValue.delete(), resolutionNote: FieldValue.delete(), resolvedAt: FieldValue.delete() }); else transaction.create(adminDb.collection("clarificationItems").doc(), { ...data, createdBy: actorPath, createdAt: now }); }
      else if (clarificationDoc) { const parsed = parsePersistedClarification(clarificationDoc.id, clarificationDoc.data()); if (parsed && parsed.sessionId === currentSession.id && parsed.status === "open") transaction.update(clarificationDoc.ref, { status: "resolved", active: false, resolutionAnswerId: answerId, resolvedAt: now, updatedBy: actorPath, updatedAt: now }); }
      for (const snapshot of obsoleteSnapshots) for (const document of snapshot.docs) { const item = parsePersistedClarification(document.id, document.data()); if (item && item.sessionId === currentSession.id && item.candidateId === effectiveCandidateId && item.status === "open") transaction.update(document.ref, { status: "resolved", active: false, resolutionAnswerId: answerId, resolutionNote: "لم يعد السؤال منطبقًا بعد تحديث الإجابة المرتبطة.", resolvedAt: now, updatedBy: actorPath, updatedAt: now }); }
      transaction.update(sessionSnapshot.ref, { currentQuestionId: input.questionId, ...(input.candidateId ? { currentCandidateId: input.candidateId } : {}), updatedBy: actorPath, updatedAt: now, lastActivityAt: now });
      return canonicalAnswers.filter((entry) => entry.id !== answerId).concat({ id: answerId, ...answerData });
    });
    if (session.engineVersion === "guided-v2") { const state = nextV2State(updatedAnswers, session.id); traceGuidedOperation({ operation: "guided-answer.v2", queries: 2, documentsReturned: updatedAnswers.length, writesAtLeast: 2, conditionalWrites: "clarification lifecycle", evidenceLoads: 1 }); return NextResponse.json({ success: true, answerId, savedAnswer: updatedAnswers.find((answer) => answer.id === answerId), ...state, ...(state.stage === "complete" ? { reviewAnswers: updatedAnswers } : {}) }); }
    const answers = await loadAnswers(session, input.candidateId); const next = nextQuestion(answers, input.subjectKey, input.subjectType);
    return NextResponse.json({ success: true, answerId, nextQuestion: next ? publicQuestion(next) : null });
  } catch (error) { return guidedError(error); }
}
