import { strict as assert } from "node:assert";

import { GuidedAnswer, ProcedureCandidate, guidedAnswerDocumentId, parseAnswerSubmission, parseAnswerValue, parseSessionCreate } from "@/lib/guided-documentation";
import { QUESTION_REGISTRY, buildV14Projection, classificationRecommendation, conversionReadinessError, nextQuestionForStages, validateQuestionAnswer } from "@/lib/guided-question-registry";

function answer(subjectKey: string, questionId: string, value: GuidedAnswer["answer"]): GuidedAnswer {
  const candidateId = questionId.startsWith("step.") ? "candidate" : subjectKey;
  return { id: guidedAnswerDocumentId("session", subjectKey, questionId, candidateId)!, companyId: "company", projectId: "project", organizationUnitId: "unit", sessionId: "session", subjectType: questionId.startsWith("step.") ? "step" : "candidate", subjectKey, questionId, ruleId: QUESTION_REGISTRY.get(questionId)?.ruleId ?? "test-rule", answer: value, certainty: "confirmed", active: true, answeredBy: "users/actor", ...(questionId.startsWith("step.") ? { candidateId: "candidate", stepKey: subjectKey } : { candidateId: subjectKey }) };
}

export function runGuidedDocumentationAssertions() {
  assert.equal(parseSessionCreate({ companyId: "c", projectId: "p", organizationUnitId: "u", subjectType: "organization_unit", extra: true }), null, "session parser must reject extra client fields");
  assert.equal(parseSessionCreate({ companyId: "c", projectId: "p", organizationUnitId: "u", subjectType: "user" }), null, "user subjects require subjectUserId");
  assert.equal(parseAnswerValue({ kind: "number", value: Number.NaN }), null, "non-finite answers must fail");
  assert.equal(parseAnswerSubmission({ sessionId: "s", candidateId: "c", subjectType: "session", subjectKey: "s", questionId: "discovery.complete", answer: { kind: "boolean", value: true }, certainty: "confirmed" }), null, "session answers cannot be attached to candidates");
  assert.equal(guidedAnswerDocumentId("a-b", "c", "d"), guidedAnswerDocumentId("a-b", "c", "d"), "answer retries must be idempotent");
  assert.notEqual(guidedAnswerDocumentId("a:b", "c", "d"), guidedAnswerDocumentId("a", "b:c", "d"), "length-prefixed canonical components must not collide at delimiters");
  assert.notEqual(guidedAnswerDocumentId("session", "step", "question", "candidate-a"), guidedAnswerDocumentId("session", "step", "question", "candidate-b"), "step answers are framed by candidate identity");

  const candidateId = "candidate"; const classification = [
    answer(candidateId, "classification.independent_trigger", { kind: "boolean", value: true }),
    answer(candidateId, "classification.independent_outcome", { kind: "boolean", value: true }),
    answer(candidateId, "classification.business_output", { kind: "boolean", value: true }),
  ];
  assert.equal(classificationRecommendation(classification, candidateId), "procedure", "strong independent signals recommend procedure");
  const stepKey = "s001-00000000-0000-4000-8000-000000000000";
  const roleAnswers = [answer(stepKey, "step.name", { kind: "text", value: "تنفيذ" }), answer(stepKey, "step.performer.type", { kind: "choice", value: "role" })];
  assert.equal(nextQuestionForStages(roleAnswers, stepKey, "step", ["step_core"])?.id, "step.performer.role", "role performer skips irrelevant user reference");
  const reviewFalse = [...roleAnswers, answer(stepKey, "step.performer.role", { kind: "text", value: "مسؤول" }), answer(stepKey, "step.organization_unit", { kind: "reference", referenceType: "organization_unit", referenceId: "unit" }), answer(stepKey, "step.continue", { kind: "boolean", value: false })];
  assert.notEqual(nextQuestionForStages(reviewFalse, stepKey, "step", ["step_core"])?.id, "step.performer.user", "conditional user question stays inapplicable");
  const documentQuestion = QUESTION_REGISTRY.get("step.documents")!;
  assert.equal(validateQuestionAnswer(documentQuestion, { kind: "items", values: [{ name: "نموذج", type: "invalid" }] }), false, "document item types must use V1.4 enum");
  const candidate: ProcedureCandidate = { id: candidateId, companyId: "company", projectId: "project", organizationUnitId: "unit", sessionId: "session", label: "مرشح", classification: "procedure", status: "confirmed_procedure", originQuestionId: "discovery.frequency.daily", active: true, createdBy: "users/actor", updatedBy: "users/actor" };
  const projectionAnswers = [
    answer(candidateId, "procedure.name", { kind: "text", value: "إجراء تجريبي" }), answer(candidateId, "procedure.objective", { kind: "text", value: "تحقيق نتيجة واضحة" }), answer(candidateId, "procedure.trigger.type", { kind: "choice", value: "other" }), answer(candidateId, "procedure.trigger.description", { kind: "text", value: "بداية محددة" }), answer(candidateId, "procedure.frequency.type", { kind: "choice", value: "daily" }), answer(candidateId, "procedure.inputs", { kind: "items", values: [{ name: "طلب" }] }), answer(candidateId, "procedure.outputs", { kind: "items", values: [{ name: "نتيجة" }] }), answer(candidateId, "confirmation.final", { kind: "boolean", value: true }),
    answer(stepKey, "step.name", { kind: "text", value: "تنفيذ الخطوة" }), answer(stepKey, "step.performer.type", { kind: "choice", value: "role" }), answer(stepKey, "step.performer.role", { kind: "text", value: "مسؤول" }), answer(stepKey, "step.organization_unit", { kind: "reference", referenceType: "organization_unit", referenceId: "unit" }), answer(stepKey, "step.inputs", { kind: "items", values: [{ name: "مدخل" }] }), answer(stepKey, "step.outputs", { kind: "items", values: [{ name: "مخرج" }] }), answer(stepKey, "step.systems", { kind: "items", values: [{ name: "نظام" }] }), answer(stepKey, "step.documents", { kind: "items", values: [{ name: "نموذج", type: "form" }] }), answer(stepKey, "step.required_permissions", { kind: "items", values: [{ systemName: "نظام", permission: "إدخال" }] }), answer(stepKey, "step.timing.processing", { kind: "duration", value: 5, unit: "minutes" }), answer(stepKey, "step.timing.waiting", { kind: "duration", value: 0, unit: "minutes" }), answer(stepKey, "step.review.required", { kind: "boolean", value: false }), answer(stepKey, "step.approval.required", { kind: "boolean", value: false }), answer(stepKey, "step.decision.is_decision", { kind: "boolean", value: false }), answer(stepKey, "step.exceptions", { kind: "items", values: [{ condition: "خطأ", action: "تصحيح" }] }), answer(stepKey, "step.continue", { kind: "boolean", value: false }),
  ];
  const projection = buildV14Projection(candidate, projectionAnswers);
  assert.equal(projection?.steps.length, 1, "valid guided answers project to exactly one ordered V1.4 step");
  assert.equal(projection?.steps[0].documents?.[0].type, "form", "projection reuses V1.4 structured document type");
  assert.equal(conversionReadinessError(candidate, projectionAnswers), null, "complete canonical answers are conversion-ready");
  const inconsistentContinuation = projectionAnswers.map((entry) => entry.questionId === "step.continue" ? { ...entry, answer: { kind: "boolean", value: true } as const } : entry);
  assert.equal(conversionReadinessError(candidate, inconsistentContinuation), "Procedure step continuation is inconsistent.", "answer corrections cannot bypass the authoritative step loop");
  const tooManySteps = Array.from({ length: 101 }, (_, index) => answer(`s${String(index + 1).padStart(3, "0")}-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, "step.name", { kind: "text", value: "خطوة" }));
  assert.equal(buildV14Projection(candidate, [...projectionAnswers.filter((entry) => entry.subjectType !== "step"), ...tooManySteps]), null, "projection rejects more than 100 temporary steps");
  assert.equal(QUESTION_REGISTRY.size, 55, "stable V1 registry contains the expected unique questions");
}
