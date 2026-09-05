import { strict as assert } from "node:assert";
import { assessDiscovery, assessProcedure, discoveryQuestionIds } from "@/lib/quality-engine";
import { canAccessRawQualitySession } from "@/lib/quality-authorization";
import type { ClarificationItem, DocumentationSession, GuidedAnswer, ProcedureCandidate } from "@/lib/guided-documentation";
import type { PersistedProcedure, PersistedProcedureStep } from "@/lib/procedures";

const session: DocumentationSession = { id: "session", companyId: "company", projectId: "project", organizationUnitId: "unit", subjectType: "user", subjectUserId: "user", phase: "discovery", status: "active", engineVersion: "guided-v1", discoveryPromptSetVersion: "discovery-v1", active: true, createdBy: "users/actor", updatedBy: "users/actor" };
const candidate: ProcedureCandidate = { id: "candidate", companyId: "company", projectId: "project", organizationUnitId: "unit", sessionId: "session", label: "عمل", classification: "unclassified", status: "discovered", originQuestionId: "discovery.frequency.daily", active: true, createdBy: "users/actor", updatedBy: "users/actor" };
function discoveryAnswer(questionId: string, certainty: GuidedAnswer["certainty"] = "confirmed"): GuidedAnswer { return { id: `answer-${questionId}`, companyId: "company", projectId: "project", organizationUnitId: "unit", sessionId: "session", subjectType: "session", subjectKey: "session", questionId, ruleId: `${questionId}.v1`, answer: questionId === "discovery.complete" ? { kind: "boolean", value: true } : { kind: "text", value: "لا يوجد" }, certainty, active: true, answeredBy: "users/actor" }; }
function clarification(severity: ClarificationItem["severity"]): ClarificationItem { return { id: `${severity}-clarification`, companyId: "company", projectId: "project", organizationUnitId: "unit", sessionId: "session", subjectType: "session", subjectKey: "session", questionId: "discovery.frequency.daily", category: "needs_check", severity, summary: "Review", status: "open", active: true }; }
const procedure: PersistedProcedure = { id: "procedure", companyId: "company", projectId: "project", organizationUnitId: "unit", name: "إجراء", objective: "نتيجة", trigger: { type: "event" }, frequency: { type: "event_driven" }, status: "draft", active: true };
function step(overrides: Partial<PersistedProcedureStep> = {}): PersistedProcedureStep { return { id: "step-1", companyId: "company", projectId: "project", procedureId: "procedure", sequence: 1, name: "تنفيذ", active: true, performer: { type: "role", role: "مسؤول" }, outputs: [{ name: "نتيجة" }], ...overrides }; }

export function runQualityEngineAssertions() {
  const questions = discoveryQuestionIds("discovery-v1"); const complete = [...questions.map((id) => discoveryAnswer(id)), discoveryAnswer("discovery.complete")];
  const wellCovered = assessDiscovery({ session, answers: complete, candidates: [], clarifications: [], applicableQuestionIds: questions });
  assert.equal(wellCovered.state, "well_covered"); assert.deepEqual(wellCovered.coverage, { applicable: questions.length, answered: questions.length, confirmed: questions.length, uncertain: 0 });
  const missing = assessDiscovery({ session, answers: complete.slice(1), candidates: [], clarifications: [], applicableQuestionIds: questions }); assert.equal(missing.counts.blocking, 1);
  const uncertain = assessDiscovery({ session, answers: [discoveryAnswer(questions[0], "approximate"), ...complete.slice(1)], candidates: [], clarifications: [], applicableQuestionIds: questions }); assert.equal(uncertain.counts.warning, 1);
  assert.equal(assessDiscovery({ session, answers: complete, candidates: [], clarifications: [clarification("required")], applicableQuestionIds: questions }).counts.blocking, 1);
  assert.equal(assessDiscovery({ session, answers: complete, candidates: [], clarifications: [clarification("recommended")], applicableQuestionIds: questions }).counts.warning, 1);
  const undispositioned = assessDiscovery({ session, answers: complete, candidates: [candidate], clarifications: [], applicableQuestionIds: questions }); assert.ok(undispositioned.findings.some((item) => item.ruleId === "discovery.candidate.undispositioned.v1"));
  const noSteps = assessProcedure({ procedure, steps: [] }); assert.ok(noSteps.findings.some((item) => item.ruleId === "procedure.active-step.required.v1"));
  const noPerformer = assessProcedure({ procedure, steps: [step({ performer: undefined })] }); assert.equal(noPerformer.state, "needs_work");
  const warningOnly = assessProcedure({ procedure: { ...procedure, frequency: { type: "other" } }, steps: [step()] }); assert.equal(warningOnly.state, "review_improvements_available"); assert.equal(warningOnly.counts.blocking, 0);
  const clean = assessProcedure({ procedure, steps: [step()] }); assert.equal(clean.state, "eligible_for_review");
  const duplicate = assessProcedure({ procedure, steps: [step(), step({ id: "step-2" })] }); assert.ok(duplicate.findings.some((item) => item.ruleId === "consistency.step.sequence-duplicate.v1"));
  assert.ok(assessProcedure({ procedure, steps: [step({ approval: { required: true } })] }).findings.some((item) => item.ruleId === "consistency.approval-without-performer.v1"));
  assert.ok(assessProcedure({ procedure, steps: [step({ review: { required: true } })] }).findings.some((item) => item.ruleId === "consistency.review-without-performer.v1"));
  assert.ok(assessProcedure({ procedure, steps: [step({ decision: { isDecision: true } })] }).findings.some((item) => item.ruleId === "consistency.decision-without-question.v1"));
  assert.ok(assessProcedure({ procedure, steps: [step({ timing: { waiting: { value: 2, unit: "hours" } } })] }).findings.some((item) => item.ruleId === "consistency.waiting-without-dependency.v1"));
  assert.ok(assessProcedure({ procedure, steps: [step({ systems: [{ name: "ERP" }], requiredPermissions: [{ systemName: "CRM", permission: "read" }] })] }).findings.some((item) => item.ruleId === "consistency.permission-without-system.v1"));
  const reversedRegistryInput = assessDiscovery({ session, answers: [...complete].reverse(), candidates: [], clarifications: [], applicableQuestionIds: [...questions].reverse() }); assert.deepEqual(reversedRegistryInput.findings, wellCovered.findings, "input ordering must not alter canonical findings");
  assert.equal(clean.engineVersion, "quality-engine.v1"); assert.equal(clean.ruleSetVersion, "quality-ruleset.v1"); assert.equal(new Set(duplicate.findings.map((item) => item.id)).size, duplicate.findings.length, "finding IDs must be stable and unique");
  const framedA = assessProcedure({ procedure: { ...procedure, id: "a:b" }, steps: [] }).findings[0].id; const framedB = assessProcedure({ procedure: { ...procedure, id: "a", name: "b" }, steps: [] }).findings[0].id; assert.notEqual(framedA, framedB, "finding identity must frame delimiter-like document IDs safely");
  const actor = { id: "user", authUid: "auth-user", companyId: "company", name: "User", email: "user@example.com", role: "employee" as const, active: true as const, language: "ar" as const };
  assert.equal(canAccessRawQualitySession(actor, session), true, "employees may assess their own raw session");
  assert.equal(canAccessRawQualitySession({ ...actor, id: "other" }, session), false, "employees cannot assess another employee session");
  assert.equal(canAccessRawQualitySession({ ...actor, role: "president" }, session), false, "presidents never receive raw session quality");
  assert.equal(canAccessRawQualitySession({ ...actor, companyId: "other-company", role: "project_manager" }, session), false, "cross-company raw quality is denied");
}
