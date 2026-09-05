import { NextResponse } from "next/server";

import { GuidedAccessError, requireGuidedActor, requireSessionAccess } from "@/lib/guided-authorization";
import { createStepKey } from "@/lib/guided-documentation";
import { QUESTION_REGISTRY, activeAnswer, classificationRecommendation, nextQuestionForStages, nextV2State, publicQuestion } from "@/lib/guided-question-registry";
import { exactQuery, guidedError, loadAnswers, loadCandidate, loadClarifications } from "@/lib/guided-store";
import { isValidFirestoreDocumentId } from "@/lib/request-validation";
import { traceGuidedOperation } from "@/lib/guided-observability";

export async function GET(request: Request) {
  try {
    const actor = await requireGuidedActor();
    const params = new URL(request.url).searchParams;
    if (!exactQuery(params, ["sessionId"], ["candidateId", "stepKey", "clarificationId"])) throw new GuidedAccessError("Invalid next-question query.", 400);
    const sessionId = params.get("sessionId"); const candidateId = params.get("candidateId"); const requestedStepKey = params.get("stepKey"); const clarificationId = params.get("clarificationId");
    if (!sessionId || !isValidFirestoreDocumentId(sessionId) || candidateId && !isValidFirestoreDocumentId(candidateId) || requestedStepKey && !isValidFirestoreDocumentId(requestedStepKey) || clarificationId && !isValidFirestoreDocumentId(clarificationId)) throw new GuidedAccessError("Invalid guided scope.", 400);
    const session = await requireSessionAccess(sessionId, actor);
    if (!session.active || session.status !== "active") return NextResponse.json({ success: true, stage: "complete", nextQuestion: null });
    if (session.engineVersion === "guided-v2") {
      if (candidateId || clarificationId) throw new GuidedAccessError("V2 sessions do not use procedure candidates.", 400);
      const answers = await loadAnswers(session); traceGuidedOperation({ operation: "guided-next.v2", queries: 1, documentsReturned: answers.length, writesAtLeast: 0, evidenceLoads: 1 });
      return NextResponse.json({ success: true, ...nextV2State(answers, session.id) });
    }
    if (session.phase === "discovery") {
      const answers = await loadAnswers(session);
      const question = nextQuestionForStages(answers, session.id, "session", ["discovery_context"]);
      return NextResponse.json({ success: true, stage: question?.stage ?? "candidate_classification", subjectType: "session", subjectKey: session.id, nextQuestion: question ? publicQuestion(question) : null });
    }
    if (!candidateId) throw new GuidedAccessError("A candidate is required for this phase.", 400);
    const candidate = await loadCandidate(session, candidateId); const answers = await loadAnswers(session, candidate.id);
    if (clarificationId) { if (candidate.status === "converted") throw new GuidedAccessError("Converted guided history is immutable.", 409); const result = await loadClarifications(session, candidate.id); const item = result.clarifications.find((entry) => entry.id === clarificationId && entry.active && entry.status === "open"); const question = item ? QUESTION_REGISTRY.get(item.questionId) : null; if (!item || !question || question.subjectType !== item.subjectType) throw new GuidedAccessError("Open clarification not found.", 404); return NextResponse.json({ success: true, stage: "clarification_review", subjectType: item.subjectType, subjectKey: item.subjectKey, stepKey: item.stepKey, nextQuestion: publicQuestion(question) }); }
    if (["discovered", "refining"].includes(candidate.status)) {
      const question = nextQuestionForStages(answers, candidate.id, "candidate", ["candidate_classification"]);
      return NextResponse.json({ success: true, stage: "candidate_classification", subjectType: "candidate", subjectKey: candidate.id, recommendation: classificationRecommendation(answers, candidate.id), nextQuestion: question ? publicQuestion(question) : null });
    }
    if (candidate.status === "excluded" || candidate.status === "converted") return NextResponse.json({ success: true, stage: "complete", procedureId: candidate.procedureId, nextQuestion: null });
    if (candidate.status !== "confirmed_procedure") throw new GuidedAccessError("Candidate is not ready for documentation.", 409);
    if (session.phase === "classification") return NextResponse.json({ success: true, stage: "procedure_basics", readyForDocumentation: true, nextQuestion: null });
    const basics = nextQuestionForStages(answers, candidate.id, "candidate", ["procedure_basics", "procedure_inputs"]);
    if (basics) return NextResponse.json({ success: true, stage: basics.stage, subjectType: "candidate", subjectKey: candidate.id, nextQuestion: publicQuestion(basics) });
    const stepKeys = [...new Set(answers.filter((answer) => answer.subjectType === "step" && answer.candidateId === candidate.id && answer.stepKey).map((answer) => answer.stepKey as string))].sort();
    let stepKey = requestedStepKey && stepKeys.includes(requestedStepKey) ? requestedStepKey : stepKeys.at(-1);
    if (!stepKey) stepKey = createStepKey(1);
    const stepQuestion = nextQuestionForStages(answers, stepKey, "step", ["step_core", "step_resources", "step_controls"]);
    if (stepQuestion) return NextResponse.json({ success: true, stage: stepQuestion.stage, subjectType: "step", subjectKey: stepKey, stepKey, stepNumber: stepKeys.includes(stepKey) ? stepKeys.indexOf(stepKey) + 1 : 1, nextQuestion: publicQuestion(stepQuestion) });
    const shouldContinue = activeAnswer(answers, stepKey, "step.continue")?.answer;
    if (shouldContinue?.kind === "boolean" && shouldContinue.value) {
      if (stepKeys.length >= 100) throw new GuidedAccessError("A candidate cannot exceed 100 temporary steps.", 409);
      const newKey = createStepKey(stepKeys.length + 1); const question = nextQuestionForStages(answers, newKey, "step", ["step_core"]);
      return NextResponse.json({ success: true, stage: "step_core", subjectType: "step", subjectKey: newKey, stepKey: newKey, stepNumber: stepKeys.length + 1, nextQuestion: question ? publicQuestion(question) : null });
    }
    const outputs = nextQuestionForStages(answers, candidate.id, "candidate", ["procedure_outputs"]);
    if (outputs) return NextResponse.json({ success: true, stage: outputs.stage, subjectType: "candidate", subjectKey: candidate.id, nextQuestion: publicQuestion(outputs) });
    const clarificationResult = await loadClarifications(session, candidate.id); const open = clarificationResult.clarifications.filter((item) => item.active && item.status === "open");
    const confirmation = nextQuestionForStages(answers, candidate.id, "candidate", ["confirmation"]);
    return NextResponse.json({ success: true, stage: confirmation ? "confirmation" : "complete", subjectType: "candidate", subjectKey: candidate.id, blockers: open.filter((item) => item.severity === "required").length, warnings: open.filter((item) => item.severity === "recommended").length, nextQuestion: confirmation ? publicQuestion(confirmation) : null });
  } catch (error) { return guidedError(error); }
}
