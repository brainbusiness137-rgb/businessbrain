import {
  DOCUMENT_TYPES,
  FREQUENCY_TYPES,
  PERFORMER_TYPES,
  TRIGGER_TYPES,
  parseProcedureCreateInput,
  parseProcedureStepCreateInput,
} from "@/lib/procedures";
import { GuidedAnswer, GuidedAnswerValue, GuidedProjection, ProcedureCandidate, createStepKey } from "@/lib/guided-documentation";

export type GuidedStage = "discovery_context" | "candidate_classification" | "procedure_basics" | "procedure_inputs" | "step_core" | "step_resources" | "step_controls" | "procedure_outputs" | "clarification_review" | "confirmation" | "complete";
export type QuestionDefinition = {
  id: string; ruleId: string; stage: GuidedStage; priority: number;
  subjectType: "session" | "candidate" | "step";
  answerKind: GuidedAnswerValue["kind"];
  choices?: readonly string[]; promptAr: string; helpAr?: string;
  uncertainty: boolean;
};

const discovery = [
  ["daily", "في شغل بتعمله كل يوم؟"], ["weekly", "في شغل بتعمله كل أسبوع؟"],
  ["monthly", "في إجراءات بتحصل كل شهر؟"], ["quarterly", "في شغل بيتكرر كل ربع سنة؟"],
  ["semiannual", "في شغل بيتكرر كل نصف سنة؟"], ["annual", "في إجراءات سنوية؟"],
  ["irregular", "في شغل بيحصل بشكل غير منتظم؟"],
] as const;
const events = [
  ["request_received", "لما يوصلك طلب، إيه الشغل اللي ممكن يبدأ؟"],
  ["document_received", "لما يوصلك مستند، بتبدأ إجراءات معينة؟"],
  ["manager_request", "لما المدير يطلب حاجة، إيه الشغل المتكرر؟"],
  ["customer_supplier", "هل تواصل عميل أو مورد بيبدأ شغل عندك؟"],
  ["payment_needed", "لما يكون في دفع مطلوب، إيه اللي بيحصل؟"],
  ["employee_change", "لما موظف ينضم أو يسيب العمل، إيه اللي بيحصل؟"],
  ["system_notification", "هل إشعار من نظام بيبدأ شغل معين؟"],
  ["problem", "لما تحصل مشكلة أو حالة استثنائية، بتعمل إيه؟"],
  ["month_end", "إيه الشغل اللي بيحصل آخر الشهر؟"],
  ["year_end", "إيه الشغل اللي بيحصل آخر السنة؟"],
  ["on_demand", "في شغل بتعمله عند الطلب؟"],
] as const;

const definitions: QuestionDefinition[] = [
  ...discovery.map(([key, promptAr], index) => ({ id: `discovery.frequency.${key}`, ruleId: `discovery.frequency.${key}.v1`, stage: "discovery_context" as const, priority: 10 + index, subjectType: "session" as const, answerKind: "text" as const, promptAr, uncertainty: true })),
  ...events.map(([key, promptAr], index) => ({ id: `discovery.event.${key}`, ruleId: `discovery.event.${key}.v1`, stage: "discovery_context" as const, priority: 30 + index, subjectType: "session" as const, answerKind: "text" as const, promptAr, uncertainty: true })),
  { id: "discovery.complete", ruleId: "discovery.completion-confirmed.v1", stage: "discovery_context", priority: 50, subjectType: "session", answerKind: "boolean", promptAr: "هل راجعنا أنواع الشغل المختلفة ونقدر نبدأ ترتيب اللي اكتشفناه؟", uncertainty: false },
  ...[
    ["independent_trigger", "هل الشغل ده له بداية أو سبب مستقل؟"],
    ["independent_outcome", "هل له هدف أو نتيجة مستقلة؟"],
    ["multiple_activities", "هل بيتكوّن من أكتر من خطوة؟"],
    ["business_output", "هل بينتج عنه مخرج واضح؟"],
    ["recurs_independently", "هل بيتكرر بشكل مستقل؟"],
    ["part_of_other", "هل هو غالبًا جزء من إجراء أكبر؟"],
    ["responsibility_handoff", "هل المسؤولية بتنتقل بين أشخاص أو وحدات؟"],
  ].map(([key, promptAr], index) => ({ id: `classification.${key}`, ruleId: `classification.${key}.v1`, stage: "candidate_classification" as const, priority: 100 + index, subjectType: "candidate" as const, answerKind: "boolean" as const, promptAr, uncertainty: true })),
  { id: "procedure.name", ruleId: "procedure.name.required.v1", stage: "procedure_basics", priority: 200, subjectType: "candidate", answerKind: "text", promptAr: "إيه الاسم البسيط اللي يوضح الإجراء؟", uncertainty: false },
  { id: "procedure.objective", ruleId: "procedure.objective.required.v1", stage: "procedure_basics", priority: 201, subjectType: "candidate", answerKind: "text", promptAr: "إيه الهدف أو النتيجة المطلوبة من الإجراء؟", uncertainty: true },
  { id: "procedure.trigger.type", ruleId: "procedure.trigger.required.v1", stage: "procedure_basics", priority: 202, subjectType: "candidate", answerKind: "choice", choices: TRIGGER_TYPES, promptAr: "إيه اللي بيبدأ الإجراء؟", uncertainty: false },
  { id: "procedure.trigger.description", ruleId: "procedure.trigger-description.v1", stage: "procedure_basics", priority: 203, subjectType: "candidate", answerKind: "text", promptAr: "اشرح البداية أو الحدث بكلمات بسيطة.", uncertainty: true },
  { id: "procedure.frequency.type", ruleId: "procedure.frequency.required.v1", stage: "procedure_basics", priority: 204, subjectType: "candidate", answerKind: "choice", choices: FREQUENCY_TYPES, promptAr: "الإجراء ده بيتكرر كل قد إيه؟", uncertainty: false },
  { id: "procedure.inputs", ruleId: "procedure.inputs.v1", stage: "procedure_inputs", priority: 220, subjectType: "candidate", answerKind: "items", promptAr: "إيه المعلومات أو المستندات اللي بتحتاجها قبل البداية؟", uncertainty: true },
  { id: "step.name", ruleId: "step.name.required.v1", stage: "step_core", priority: 300, subjectType: "step", answerKind: "text", promptAr: "إيه اللي بيحصل في الخطوة دي؟", uncertainty: false },
  { id: "step.performer.type", ruleId: "step.performer.type.v1", stage: "step_core", priority: 301, subjectType: "step", answerKind: "choice", choices: PERFORMER_TYPES, promptAr: "مين بيعمل الخطوة دي؟", uncertainty: true },
  { id: "step.performer.user", ruleId: "step.performer.user-if-selected.v1", stage: "step_core", priority: 302, subjectType: "step", answerKind: "reference", promptAr: "اختار الشخص اللي بينفذ الخطوة.", uncertainty: true },
  { id: "step.performer.role", ruleId: "step.performer.role-if-selected.v1", stage: "step_core", priority: 303, subjectType: "step", answerKind: "text", promptAr: "إيه المسؤولية أو الدور اللي بينفذ الخطوة؟", uncertainty: true },
  { id: "step.organization_unit", ruleId: "step.organization-unit.v1", stage: "step_core", priority: 304, subjectType: "step", answerKind: "reference", promptAr: "الخطوة تابعة لأي وحدة تنظيمية؟", uncertainty: true },
  ...["inputs", "outputs", "systems"].map((key, index) => ({ id: `step.${key}`, ruleId: `step.${key}.v1`, stage: "step_resources" as const, priority: 320 + index, subjectType: "step" as const, answerKind: "items" as const, promptAr: key === "systems" ? "هل بتستخدم نظام أو أداة؟" : key === "inputs" ? "إيه مدخلات الخطوة؟" : "إيه مخرجات الخطوة؟", uncertainty: true })),
  { id: "step.documents", ruleId: "step.documents.v1", stage: "step_resources", priority: 324, subjectType: "step", answerKind: "items", promptAr: "هل بتستخدم مستند أو نموذج؟", uncertainty: true },
  { id: "step.required_permissions", ruleId: "step.required-permissions.v1", stage: "step_resources", priority: 325, subjectType: "step", answerKind: "items", promptAr: "هل محتاج صلاحية داخل نظام معين؟", uncertainty: true },
  { id: "step.timing.processing", ruleId: "step.processing-time.v1", stage: "step_resources", priority: 330, subjectType: "step", answerKind: "duration", promptAr: "الخطوة نفسها بتاخد وقت قد إيه؟", uncertainty: true },
  { id: "step.timing.waiting", ruleId: "step.waiting-time.v1", stage: "step_resources", priority: 331, subjectType: "step", answerKind: "duration", promptAr: "هل بتستنى حاجة قبل ما تكمل؟ ومدة الانتظار؟", uncertainty: true },
  { id: "step.review.required", ruleId: "step.review.required.v1", stage: "step_controls", priority: 340, subjectType: "step", answerKind: "boolean", promptAr: "هل حد بيراجع الخطوة؟", uncertainty: false },
  { id: "step.review.performer", ruleId: "step.review.performer-if-required.v1", stage: "step_controls", priority: 341, subjectType: "step", answerKind: "text", promptAr: "مين المسؤول عن المراجعة؟", uncertainty: true },
  { id: "step.approval.required", ruleId: "step.approval.required.v1", stage: "step_controls", priority: 342, subjectType: "step", answerKind: "boolean", promptAr: "هل الخطوة محتاجة اعتماد؟", uncertainty: false },
  { id: "step.approval.performer", ruleId: "step.approval.performer-if-required.v1", stage: "step_controls", priority: 343, subjectType: "step", answerKind: "text", promptAr: "مين صاحب الاعتماد؟", uncertainty: true },
  { id: "step.approval.condition", ruleId: "step.approval.condition.v1", stage: "step_controls", priority: 344, subjectType: "step", answerKind: "text", promptAr: "هل الاعتماد مطلوب في حالة معينة؟", uncertainty: true },
  { id: "step.decision.is_decision", ruleId: "step.decision.required.v1", stage: "step_controls", priority: 345, subjectType: "step", answerKind: "boolean", promptAr: "هل ممكن يحصل سيناريو مختلف هنا؟", uncertainty: false },
  { id: "step.decision.question", ruleId: "step.decision-question-if-needed.v1", stage: "step_controls", priority: 346, subjectType: "step", answerKind: "text", promptAr: "إيه السؤال أو الشرط اللي بيحدد السيناريو؟", uncertainty: true },
  { id: "step.exceptions", ruleId: "step.exceptions.v1", stage: "step_controls", priority: 347, subjectType: "step", answerKind: "items", promptAr: "لو حصل استثناء، إيه الحالة وإيه التصرف؟", uncertainty: true },
  { id: "step.continue", ruleId: "step.continue.v1", stage: "step_core", priority: 360, subjectType: "step", answerKind: "boolean", promptAr: "بعد كده في خطوة تانية؟", uncertainty: false },
  { id: "procedure.outputs", ruleId: "procedure.outputs.v1", stage: "procedure_outputs", priority: 400, subjectType: "candidate", answerKind: "items", promptAr: "في نهاية الإجراء، إيه النتيجة أو المخرجات؟", uncertainty: true },
  { id: "confirmation.final", ruleId: "confirmation.explicit.v1", stage: "confirmation", priority: 500, subjectType: "candidate", answerKind: "boolean", promptAr: "هل ده وصف صحيح ونقدر نحوله لإجراء؟", uncertainty: false },
];

export const QUESTION_REGISTRY = new Map(definitions.map((question) => [question.id, question]));
export function publicQuestion(question: QuestionDefinition) {
  return { id: question.id, stage: question.stage, promptAr: question.promptAr, helpAr: question.helpAr, answerKind: question.answerKind, choices: question.choices, uncertainty: question.uncertainty };
}
export function nextV2State(answers: GuidedAnswer[], sessionId: string) {
  const basics = nextQuestionForStages(answers, sessionId, "candidate", ["procedure_basics", "procedure_inputs"]); if (basics) return { stage: basics.stage, subjectType: "candidate" as const, subjectKey: sessionId, nextQuestion: publicQuestion(basics) };
  const stepKeys = [...new Set(answers.filter((answer) => answer.subjectType === "step" && answer.stepKey).map((answer) => answer.stepKey as string))].sort(); let stepKey = stepKeys.at(-1) ?? createStepKey(1);
  const stepQuestion = nextQuestionForStages(answers, stepKey, "step", ["step_core", "step_resources", "step_controls"]); if (stepQuestion) return { stage: stepQuestion.stage, subjectType: "step" as const, subjectKey: stepKey, stepKey, stepNumber: stepKeys.includes(stepKey) ? stepKeys.indexOf(stepKey) + 1 : 1, nextQuestion: publicQuestion(stepQuestion) };
  const continued = answers.find((answer) => answer.active && answer.subjectKey === stepKey && answer.questionId === "step.continue")?.answer; if (continued?.kind === "boolean" && continued.value) { stepKey = createStepKey(stepKeys.length + 1); const question = nextQuestionForStages(answers, stepKey, "step", ["step_core"]); return { stage: "step_core" as const, subjectType: "step" as const, subjectKey: stepKey, stepKey, stepNumber: stepKeys.length + 1, nextQuestion: question ? publicQuestion(question) : null }; }
  const outputs = nextQuestionForStages(answers, sessionId, "candidate", ["procedure_outputs"]); if (outputs) return { stage: outputs.stage, subjectType: "candidate" as const, subjectKey: sessionId, nextQuestion: publicQuestion(outputs) };
  const confirmation = nextQuestionForStages(answers, sessionId, "candidate", ["confirmation"]); return { stage: confirmation ? "confirmation" as const : "complete" as const, subjectType: "candidate" as const, subjectKey: sessionId, nextQuestion: confirmation ? publicQuestion(confirmation) : null };
}
export function v2ProjectionAnswers(answers: GuidedAnswer[], sessionId: string) { return answers.map((answer) => ({ ...answer, candidateId: sessionId })); }
export function validateQuestionAnswer(question: QuestionDefinition, answer: GuidedAnswerValue) {
  if (answer.kind !== question.answerKind) return false;
  if (answer.kind === "choice") return !question.choices || question.choices.includes(answer.value);
  if (answer.kind === "reference") return question.id === "step.performer.user" ? answer.referenceType === "user" : question.id === "step.organization_unit" && answer.referenceType === "organization_unit";
  if (answer.kind === "items") {
    if (question.id === "step.required_permissions") return answer.values.every((item) => Boolean(item.systemName && item.permission));
    if (question.id === "step.exceptions") return answer.values.every((item) => Boolean(item.condition && item.action));
    if (question.id === "step.documents") return answer.values.every((item) => Boolean(item.name && DOCUMENT_TYPES.includes(item.type as never)));
    return answer.values.every((item) => Boolean(item.name));
  }
  return true;
}
function answerFor(answers: GuidedAnswer[], subjectKey: string, questionId: string) { return answers.find((entry) => entry.active && entry.subjectKey === subjectKey && entry.questionId === questionId); }
function booleanFor(answers: GuidedAnswer[], key: string, questionId: string) { const value = answerFor(answers, key, questionId)?.answer; return value?.kind === "boolean" ? value.value : undefined; }
function choiceFor(answers: GuidedAnswer[], key: string, questionId: string) { const value = answerFor(answers, key, questionId)?.answer; return value?.kind === "choice" ? value.value : undefined; }
function applies(question: QuestionDefinition, answers: GuidedAnswer[], subjectKey: string) {
  if (question.id === "step.performer.user") return choiceFor(answers, subjectKey, "step.performer.type") === "user";
  if (question.id === "step.performer.role") return ["role", "external", "other"].includes(choiceFor(answers, subjectKey, "step.performer.type") ?? "");
  if (question.id === "step.review.performer") return booleanFor(answers, subjectKey, "step.review.required") === true;
  if (question.id === "step.approval.performer" || question.id === "step.approval.condition") return booleanFor(answers, subjectKey, "step.approval.required") === true;
  if (question.id === "step.decision.question") return booleanFor(answers, subjectKey, "step.decision.is_decision") === true;
  return true;
}
export function classificationRecommendation(answers: GuidedAnswer[], candidateId: string) {
  const yes = (id: string) => booleanFor(answers, candidateId, id) === true;
  const no = (id: string) => booleanFor(answers, candidateId, id) === false;
  if (yes("classification.part_of_other")) return "step" as const;
  if (yes("classification.independent_trigger") && yes("classification.independent_outcome") && yes("classification.business_output")) return "procedure" as const;
  if (no("classification.independent_trigger") && no("classification.independent_outcome") && no("classification.multiple_activities")) return "task" as const;
  return "unclear" as const;
}

export function nextQuestion(answers: GuidedAnswer[], subjectKey: string, subjectType: "session" | "candidate" | "step") {
  return definitions.filter((question) => question.subjectType === subjectType && applies(question, answers, subjectKey) && !answerFor(answers, subjectKey, question.id)).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0] ?? null;
}

export function nextQuestionForStages(answers: GuidedAnswer[], subjectKey: string, subjectType: "session" | "candidate" | "step", stages: readonly GuidedStage[]) {
  return definitions.filter((question) => question.subjectType === subjectType && stages.includes(question.stage) && applies(question, answers, subjectKey) && !answerFor(answers, subjectKey, question.id)).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0] ?? null;
}

export function activeAnswer(answers: GuidedAnswer[], subjectKey: string, questionId: string) {
  return answerFor(answers, subjectKey, questionId) ?? null;
}

export function conversionReadinessError(candidate: ProcedureCandidate, answers: GuidedAnswer[]): string | null {
  if (nextQuestionForStages(answers, candidate.id, "candidate", ["procedure_basics", "procedure_inputs"])) return "Procedure basics are incomplete.";
  const stepKeys = [...new Set(answers.filter((answer) => answer.active && answer.candidateId === candidate.id && answer.subjectType === "step" && answer.stepKey).map((answer) => answer.stepKey as string))].sort();
  if (stepKeys.length === 0 || stepKeys.length > 100) return "Procedure step count is invalid.";
  for (let index = 0; index < stepKeys.length; index += 1) {
    const stepKey = stepKeys[index];
    if (!new RegExp(`^s${String(index + 1).padStart(3, "0")}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(stepKey)) return "Temporary step order is invalid.";
    if (nextQuestionForStages(answers, stepKey, "step", ["step_core", "step_resources", "step_controls"])) return "A procedure step is incomplete.";
    const continuation = activeAnswer(answers, stepKey, "step.continue")?.answer;
    if (continuation?.kind !== "boolean" || continuation.value !== (index < stepKeys.length - 1)) return "Procedure step continuation is inconsistent.";
  }
  if (nextQuestionForStages(answers, candidate.id, "candidate", ["procedure_outputs"])) return "Procedure outputs are incomplete.";
  const confirmation = activeAnswer(answers, candidate.id, "confirmation.final");
  if (!confirmation || confirmation.certainty !== "confirmed" || confirmation.answer.kind !== "boolean" || confirmation.answer.value !== true) return "Final confirmation is incomplete.";
  return null;
}

export function isQuestionApplicable(question: QuestionDefinition, answers: GuidedAnswer[], subjectKey: string) {
  return applies(question, answers, subjectKey);
}

function value(answers: GuidedAnswer[], key: string, id: string) { return answerFor(answers, key, id)?.answer; }
function text(answers: GuidedAnswer[], key: string, id: string) { const item = value(answers, key, id); return item?.kind === "text" || item?.kind === "choice" ? item.value : undefined; }
function items(answers: GuidedAnswer[], key: string, id: string) { const item = value(answers, key, id); return item?.kind === "items" ? item.values : undefined; }
export function buildV14Projection(candidate: ProcedureCandidate, answers: GuidedAnswer[]): GuidedProjection | null {
  const name = text(answers, candidate.id, "procedure.name"); const objective = text(answers, candidate.id, "procedure.objective");
  const triggerType = text(answers, candidate.id, "procedure.trigger.type"); const frequencyType = text(answers, candidate.id, "procedure.frequency.type");
  if (!name || !objective || !triggerType || !frequencyType) return null;
  const inputItems = items(answers, candidate.id, "procedure.inputs")?.map(({ name, description }) => ({ name: name ?? "", ...(description ? { description } : {}) }));
  const outputItems = items(answers, candidate.id, "procedure.outputs")?.map(({ name, description }) => ({ name: name ?? "", ...(description ? { description } : {}) }));
  const procedure = parseProcedureCreateInput({ companyId: candidate.companyId, projectId: candidate.projectId, organizationUnitId: candidate.organizationUnitId, name, objective, trigger: { type: triggerType, ...(text(answers, candidate.id, "procedure.trigger.description") ? { description: text(answers, candidate.id, "procedure.trigger.description") } : {}) }, frequency: { type: frequencyType }, status: "draft", active: true, ...(inputItems ? { inputs: inputItems } : {}), ...(outputItems ? { outputs: outputItems } : {}) });
  if (!procedure) return null;
  const stepKeys = [...new Set(answers.filter((answer) => answer.active && answer.candidateId === candidate.id && answer.subjectType === "step" && answer.stepKey).map((answer) => answer.stepKey as string))].sort();
  if (stepKeys.length === 0 || stepKeys.length > 100) return null;
  const steps = stepKeys.map((key, index) => {
    const stepName = text(answers, key, "step.name"); if (!stepName) return null;
    const performerType = text(answers, key, "step.performer.type"); const performerUser = value(answers, key, "step.performer.user"); const performerRole = text(answers, key, "step.performer.role");
    const unit = value(answers, key, "step.organization_unit");
    const processing = value(answers, key, "step.timing.processing"); const waiting = value(answers, key, "step.timing.waiting");
    const performer = performerType === "user" && performerUser?.kind === "reference" ? { type: "user", userId: performerUser.referenceId } : performerType === "role" && performerRole ? { type: "role", role: performerRole } : performerType === "organization_unit" ? { type: "organization_unit" } : performerType === "external" || performerType === "other" ? { type: performerType, description: performerRole ?? "غير محدد" } : undefined;
    const reviewRequired = booleanFor(answers, key, "step.review.required"); const reviewPerformer = text(answers, key, "step.review.performer");
    const approvalRequired = booleanFor(answers, key, "step.approval.required"); const approvalPerformer = text(answers, key, "step.approval.performer");
    const decision = booleanFor(answers, key, "step.decision.is_decision"); const decisionQuestion = text(answers, key, "step.decision.question");
    const stepInputs = items(answers, key, "step.inputs")?.map(({ name, description }) => ({ name: name ?? "", ...(description ? { description } : {}) }));
    const stepOutputs = items(answers, key, "step.outputs")?.map(({ name, description }) => ({ name: name ?? "", ...(description ? { description } : {}) }));
    const systems = items(answers, key, "step.systems")?.map(({ name, description, systemName }) => ({ name: name ?? systemName ?? "", ...(description ? { description } : {}) }));
    const documents = items(answers, key, "step.documents")?.map(({ name, type, description }) => ({ name: name ?? "", type: DOCUMENT_TYPES.includes(type as never) ? type : "other", ...(description ? { description } : {}) }));
    const requiredPermissions = items(answers, key, "step.required_permissions")?.map(({ systemName, permission, description }) => ({ systemName: systemName ?? "", permission: permission ?? "", ...(description ? { description } : {}) }));
    const exceptions = items(answers, key, "step.exceptions")?.map(({ condition, action, description }) => ({ condition: condition ?? "", action: action ?? "", ...(description ? { description } : {}) }));
    return parseProcedureStepCreateInput({ companyId: candidate.companyId, projectId: candidate.projectId, procedureId: "projection-procedure", sequence: index + 1, name: stepName, active: true, ...(unit?.kind === "reference" ? { organizationUnitId: unit.referenceId } : {}), ...(performer ? { performer } : {}), ...(stepInputs ? { inputs: stepInputs } : {}), ...(stepOutputs ? { outputs: stepOutputs } : {}), ...(systems ? { systems } : {}), ...(documents ? { documents } : {}), ...(requiredPermissions ? { requiredPermissions } : {}), ...(exceptions ? { exceptions } : {}), ...(processing?.kind === "duration" || waiting?.kind === "duration" ? { timing: { ...(processing?.kind === "duration" ? { processing: { value: processing.value, unit: processing.unit } } : {}), ...(waiting?.kind === "duration" ? { waiting: { value: waiting.value, unit: waiting.unit } } : {}) } } : {}), ...(reviewRequired !== undefined ? { review: { required: reviewRequired, ...(reviewRequired && reviewPerformer ? { performer: { type: "role", role: reviewPerformer } } : {}) } } : {}), ...(approvalRequired !== undefined ? { approval: { required: approvalRequired, ...(approvalRequired && approvalPerformer ? { performer: { type: "role", role: approvalPerformer } } : {}), ...(text(answers, key, "step.approval.condition") ? { condition: text(answers, key, "step.approval.condition") } : {}) } } : {}), ...(decision !== undefined ? { decision: { isDecision: decision, ...(decision && decisionQuestion ? { question: decisionQuestion } : {}) } } : {}) });
  });
  if (steps.some((step) => !step)) return null;
  return { procedure, steps: steps as NonNullable<(typeof steps)[number]>[] };
}
