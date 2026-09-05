import { DISCOVERY_PROMPT_SET_VERSION } from "@/lib/guided-documentation";
import { QUESTION_REGISTRY, isQuestionApplicable } from "@/lib/guided-question-registry";
import { QUALITY_DIMENSIONS, QUALITY_ENGINE_VERSION, QUALITY_RULESET_VERSION, type CandidateQualityContext, type DiscoveryQualityContext, type ProcedureQualityContext, type QualityAssessment, type QualityDimensionId, type QualityFinding, type QualitySeverity } from "@/lib/quality-types";

type Subject = QualityFinding["subject"];
function frameIdentity(parts: readonly string[]) { return parts.map((part) => `${part.length}:${part}`).join(""); }
function finding(ruleId: string, dimension: QualityDimensionId, severity: QualitySeverity, subject: Subject, messageKey: string, remediation?: QualityFinding["remediation"], messageParams?: Record<string, string | number>): QualityFinding {
  const id = frameIdentity([ruleId, subject.type, subject.id, remediation?.questionId ?? "", remediation?.targetId ?? ""]);
  return { id, ruleId, ruleVersion: "v1", dimension, severity, subject, messageKey, ...(messageParams ? { messageParams } : {}), ...(remediation ? { remediation } : {}) };
}
const severityOrder: Record<QualitySeverity, number> = { blocking: 0, warning: 1, suggestion: 2 };
function finish(assessmentType: QualityAssessment["assessmentType"], scopeType: QualityAssessment["scopeType"], scopeId: string, findings: QualityFinding[], coverage?: QualityAssessment["coverage"]): QualityAssessment {
  const sorted = [...findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || QUALITY_DIMENSIONS.indexOf(a.dimension) - QUALITY_DIMENSIONS.indexOf(b.dimension) || (a.subject.stepSequence ?? 0) - (b.subject.stepSequence ?? 0) || a.ruleId.localeCompare(b.ruleId) || a.subject.id.localeCompare(b.subject.id));
  const counts = { blocking: 0, warning: 0, suggestion: 0 }; sorted.forEach((item) => counts[item.severity]++);
  const dimensions = QUALITY_DIMENSIONS.map((id) => ({ id, blocking: sorted.filter((item) => item.dimension === id && item.severity === "blocking").length, warning: sorted.filter((item) => item.dimension === id && item.severity === "warning").length, suggestion: sorted.filter((item) => item.dimension === id && item.severity === "suggestion").length }));
  const state = assessmentType === "discovery" ? counts.blocking ? "needs_completion" : counts.warning || counts.suggestion ? "covered_with_open_points" : "well_covered" : counts.blocking ? "needs_work" : counts.warning || counts.suggestion ? "review_improvements_available" : "eligible_for_review";
  return { assessmentType, scopeType, scopeId, engineVersion: QUALITY_ENGINE_VERSION, ruleSetVersion: QUALITY_RULESET_VERSION, state, counts, ...(coverage ? { coverage } : {}), dimensions, findings: sorted };
}
function activeAnswers(answers: readonly CandidateQualityContext["answers"][number][]) { return answers.filter((answer) => answer.active); }

export function assessDiscovery(context: DiscoveryQualityContext): QualityAssessment {
  const subject: Subject = { type: "session", id: context.session.id }; const findings: QualityFinding[] = [];
  if (context.session.discoveryPromptSetVersion !== DISCOVERY_PROMPT_SET_VERSION) throw new Error("Unsupported discovery prompt-set version.");
  const answers = activeAnswers(context.answers).filter((answer) => answer.subjectType === "session" && answer.subjectKey === context.session.id);
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  for (const questionId of context.applicableQuestionIds) {
    const answer = byQuestion.get(questionId);
    if (!answer) findings.push(finding("discovery.prompt.missing.v1", "coverage", "blocking", subject, "discovery.prompt.missing", { target: "guided_question", questionId }));
    else if (answer.certainty !== "confirmed") findings.push(finding("discovery.prompt.uncertain.v1", "coverage", answer.certainty === "approximate" ? "warning" : "blocking", subject, "discovery.prompt.uncertain", { target: "guided_question", questionId }, { certainty: answer.certainty }));
  }
  const completion = byQuestion.get("discovery.complete");
  if (!completion || completion.certainty !== "confirmed" || completion.answer.kind !== "boolean" || completion.answer.value !== true) findings.push(finding("discovery.completion.unconfirmed.v1", "coverage", "blocking", subject, "discovery.completion.unconfirmed", { target: "guided_question", questionId: "discovery.complete" }));
  for (const candidate of context.candidates) {
    if (["discovered", "refining"].includes(candidate.status) || candidate.classification === "unclassified") findings.push(finding("discovery.candidate.undispositioned.v1", "coverage", "blocking", { type: "candidate", id: candidate.id }, "discovery.candidate.undispositioned", { target: "candidate", targetId: candidate.id }));
    if (candidate.classification === "unclear") findings.push(finding("discovery.candidate.unclear.v1", "clarity_and_consistency", "blocking", { type: "candidate", id: candidate.id }, "discovery.candidate.unclear", { target: "candidate", targetId: candidate.id }));
  }
  for (const clarification of context.clarifications.filter((item) => item.active && item.status === "open" && item.subjectType === "session")) findings.push(finding(`discovery.clarification.${clarification.severity}-open.v1`, "clarity_and_consistency", clarification.severity === "required" ? "blocking" : "warning", subject, "clarification.open", { target: "clarification", targetId: clarification.id }));
  const positive = answers.some((answer) => answer.questionId !== "discovery.complete" && ((answer.answer.kind === "text" && !/^(لا يوجد|لا|none)$/i.test(answer.answer.value.trim())) || answer.answer.kind !== "text"));
  if (positive && context.candidates.length === 0) findings.push(finding("discovery.candidate.none-after-positive-context.v1", "coverage", "warning", subject, "discovery.candidate.none-after-positive-context", { target: "candidate" }));
  const applicable = context.applicableQuestionIds.length; const covered = context.applicableQuestionIds.map((id) => byQuestion.get(id)).filter(Boolean);
  return finish("discovery", "session", context.session.id, findings, { applicable, answered: covered.length, confirmed: covered.filter((answer) => answer?.certainty === "confirmed").length, uncertain: covered.filter((answer) => answer?.certainty !== "confirmed").length });
}

export function assessCandidate(context: CandidateQualityContext): QualityAssessment {
  const findings: QualityFinding[] = []; const answers = activeAnswers(context.answers).filter((answer) => answer.candidateId === context.candidate.id); const byQuestion = new Map(answers.map((answer) => [`${answer.subjectKey}:${answer.questionId}`, answer]));
  const required = [...QUESTION_REGISTRY.values()].filter((question) => question.subjectType === "candidate" && ["procedure_basics", "procedure_inputs", "procedure_outputs", "confirmation"].includes(question.stage) && isQuestionApplicable(question, answers, context.candidate.id));
  for (const question of required) if (!byQuestion.has(`${context.candidate.id}:${question.id}`)) findings.push(finding("candidate.question.missing.v1", "structure", "blocking", { type: "candidate", id: context.candidate.id }, "candidate.question.missing", { target: "guided_question", questionId: question.id, targetId: context.candidate.id }));
  const stepKeys = [...new Set(answers.flatMap((answer) => answer.stepKey ? [answer.stepKey] : []))];
  for (const stepKey of stepKeys) for (const question of [...QUESTION_REGISTRY.values()].filter((item) => item.subjectType === "step" && ["step_core", "step_resources", "step_controls"].includes(item.stage) && isQuestionApplicable(item, answers, stepKey))) if (!byQuestion.has(`${stepKey}:${question.id}`)) findings.push(finding("candidate.step-question.missing.v1", question.stage === "step_core" ? "structure" : question.stage === "step_controls" ? "controls_and_decisions" : "timing_and_resources", "blocking", { type: "step", id: stepKey }, "candidate.question.missing", { target: "guided_question", questionId: question.id, targetId: stepKey }));
  for (const answer of answers) if (answer.certainty !== "confirmed") findings.push(finding("candidate.answer.uncertain.v1", "clarity_and_consistency", answer.certainty === "approximate" ? "warning" : "blocking", { type: answer.subjectType === "step" ? "step" : "candidate", id: answer.subjectKey }, "candidate.answer.uncertain", { target: "guided_question", questionId: answer.questionId, targetId: answer.subjectKey }, { certainty: answer.certainty }));
  for (const clarification of context.clarifications.filter((item) => item.active && item.status === "open")) findings.push(finding(`candidate.clarification.${clarification.severity}-open.v1`, "clarity_and_consistency", clarification.severity === "required" ? "blocking" : "warning", { type: clarification.subjectType === "step" ? "step" : "candidate", id: `${clarification.subjectKey}:${clarification.id}` }, "clarification.open", { target: "clarification", targetId: clarification.id }));
  return finish("procedure_detail", "candidate", context.candidate.id, findings);
}

export function assessProcedure(context: ProcedureQualityContext): QualityAssessment {
  const p = context.procedure; const active = context.steps.filter((step) => step.active).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)); const findings: QualityFinding[] = []; const ps: Subject = { type: "procedure", id: p.id };
  if (!p.outputs?.length && !active.at(-1)?.outputs?.length) findings.push(finding("procedure.final-output.required.v1", "flow_and_outcomes", "blocking", ps, "procedure.final-output.required", { target: "procedure_section", targetId: p.id, section: "outputs" }));
  if (!active.length) findings.push(finding("procedure.active-step.required.v1", "structure", "blocking", ps, "procedure.active-step.required", { target: "procedure_section", targetId: p.id, section: "steps" }));
  if (p.trigger.type === "other" && !p.trigger.description) findings.push(finding("procedure.trigger.description-required-for-other.v1", "structure", "blocking", ps, "procedure.trigger.description-required-for-other", { target: "procedure_section", targetId: p.id, section: "trigger" }));
  if (p.frequency.type === "other" && !p.frequency.description) findings.push(finding("procedure.frequency.description-required-for-other.v1", "structure", "warning", ps, "procedure.frequency.description-required-for-other", { target: "procedure_section", targetId: p.id, section: "frequency" }));
  const sequenceCounts = new Map<number, number>(); active.forEach((step) => sequenceCounts.set(step.sequence, (sequenceCounts.get(step.sequence) ?? 0) + 1));
  for (const step of active) {
    const ss: Subject = { type: "step", id: step.id, stepSequence: step.sequence };
    if ((sequenceCounts.get(step.sequence) ?? 0) > 1) findings.push(finding("consistency.step.sequence-duplicate.v1", "clarity_and_consistency", "blocking", ss, "step.sequence.duplicate", { target: "step", targetId: step.id }, { sequence: step.sequence }));
    if (!step.performer) findings.push(finding("step.performer.required.v1", "responsibility", "blocking", ss, "step.performer.required", { target: "step", targetId: step.id }));
    if (step.review?.required && !step.review.performer) findings.push(finding("consistency.review-without-performer.v1", "controls_and_decisions", "blocking", ss, "step.review.performer-required", { target: "step", targetId: step.id }));
    if (step.approval?.required && !step.approval.performer) findings.push(finding("consistency.approval-without-performer.v1", "controls_and_decisions", "blocking", ss, "step.approval.performer-required", { target: "step", targetId: step.id }));
    if (step.decision?.isDecision && !step.decision.question) findings.push(finding("consistency.decision-without-question.v1", "controls_and_decisions", "blocking", ss, "step.decision.question-required", { target: "step", targetId: step.id }));
    if (step.timing?.waiting && !step.inputs?.length && !step.approval?.condition && !step.decision?.isDecision) findings.push(finding("consistency.waiting-without-dependency.v1", "timing_and_resources", "warning", ss, "step.waiting.without-dependency", { target: "step", targetId: step.id }));
    if (step.requiredPermissions?.some((permission) => !step.systems?.some((system) => system.name.trim().toLocaleLowerCase() === permission.systemName.trim().toLocaleLowerCase()))) findings.push(finding("consistency.permission-without-system.v1", "timing_and_resources", "warning", ss, "step.permission.without-system", { target: "step", targetId: step.id }));
  }
  const uniqueSequences = [...sequenceCounts.keys()].sort((a, b) => a - b); if (uniqueSequences.some((sequence, index) => sequence !== index + 1)) findings.push(finding("consistency.step.sequence-discontinuous.v1", "clarity_and_consistency", "blocking", ps, "step.sequence.discontinuous", { target: "procedure_section", targetId: p.id, section: "steps" }));
  if (active.length && !active.some((step) => (step.organizationUnitId ?? p.organizationUnitId) === p.organizationUnitId)) findings.push(finding("consistency.primary-unit-absent.v1", "responsibility", "warning", ps, "procedure.primary-unit.absent", { target: "procedure_section", targetId: p.id, section: "steps" }));
  for (let i = 1; i < active.length; i++) if (active[i - 1].name.trim().toLocaleLowerCase() === active[i].name.trim().toLocaleLowerCase() && JSON.stringify(active[i - 1].performer ?? null) === JSON.stringify(active[i].performer ?? null)) findings.push(finding("consistency.step.consecutive-duplicate.v1", "clarity_and_consistency", "warning", { type: "step", id: active[i].id, stepSequence: active[i].sequence }, "step.consecutive-duplicate", { target: "step", targetId: active[i].id }));
  return finish("procedure_detail", "procedure", p.id, findings);
}

export function discoveryQuestionIds(version: string) { if (version !== DISCOVERY_PROMPT_SET_VERSION) throw new Error("Unsupported discovery prompt-set version."); return [...QUESTION_REGISTRY.values()].filter((q) => q.stage === "discovery_context" && q.id !== "discovery.complete").map((q) => q.id).sort(); }
