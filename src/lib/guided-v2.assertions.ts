import { strict as assert } from "node:assert";
import { GUIDED_ENGINE_VERSION, LEGACY_GUIDED_ENGINE_VERSION, type DocumentationSession, type GuidedAnswer, findConflictingV2Session, normalizeProcedureName, parseSessionCreate } from "@/lib/guided-documentation";
import { nextV2State, v2ProjectionAnswers } from "@/lib/guided-question-registry";

const session: DocumentationSession = { id: "session", companyId: "company", projectId: "project", organizationUnitId: "unit", subjectType: "user", subjectUserId: "employee", phase: "documentation", status: "active", engineVersion: GUIDED_ENGINE_VERSION, discoveryPromptSetVersion: "discovery-v1", active: true, createdBy: "users/employee", updatedBy: "users/employee" };
function answer(id: string, questionId: string, subjectType: GuidedAnswer["subjectType"], subjectKey: string, value: GuidedAnswer["answer"], stepKey?: string): GuidedAnswer { return { id, companyId: "company", projectId: "project", organizationUnitId: "unit", sessionId: "session", subjectType, subjectKey, questionId, ruleId: `${questionId}.v1`, answer: value, certainty: "confirmed", active: true, answeredBy: "users/employee", ...(stepKey ? { stepKey } : {}) }; }

export function runGuidedV2Assertions() {
  const parsed = parseSessionCreate({ companyId: "company", projectId: "project", organizationUnitId: "unit", subjectType: "user", subjectUserId: "employee", procedureName: " اعتماد صرف العهد " });
  assert.equal(parsed?.procedureName, "اعتماد صرف العهد", "V2 session creation requires and normalizes the working procedure name");
  assert.equal(GUIDED_ENGINE_VERSION, "guided-v2"); assert.equal(LEGACY_GUIDED_ENGINE_VERSION, "guided-v1", "legacy evidence remains version-addressable");
  const name = answer("name", "procedure.name", "candidate", session.id, { kind: "text", value: "اعتماد صرف العهد" });
  const first = nextV2State([name], session.id); assert.equal(first.nextQuestion?.id, "procedure.objective"); assert.notEqual(first.stage, "discovery_context", "new V2 sessions start directly in procedure documentation");
  assert.equal(normalizeProcedureName("  Monthly   Review "), "monthly review", "procedure-name normalization trims, collapses whitespace, and folds case");
  assert.equal(findConflictingV2Session([{ session, procedureName: "اعتماد صرف العهد" }], session, "اعتماد صرف العهد")?.id, session.id, "active same-name V2 session is reused");
  assert.equal(findConflictingV2Session([{ session, procedureName: "اعتماد صرف العهد" }], session, "  اعتماد   صرف العهد  ")?.id, session.id, "Arabic whitespace differences do not create duplicate sessions");
  assert.equal(findConflictingV2Session([{ session, procedureName: "Monthly Review" }], session, "monthly   review")?.id, session.id, "case and whitespace differences do not create duplicate sessions");
  assert.equal(findConflictingV2Session([{ session, procedureName: "اعتماد صرف العهد" }], session, "مراجعة المصروفات"), null, "different procedures in the same scope may coexist");
  assert.equal(findConflictingV2Session([{ session: { ...session, id: "other", subjectUserId: "other-user" }, procedureName: "اعتماد صرف العهد" }], session, "اعتماد صرف العهد"), null, "another employee session is not treated as resumable");
  assert.equal(findConflictingV2Session([{ session: { ...session, id: "other", companyId: "other-company" }, procedureName: "اعتماد صرف العهد" }], session, "اعتماد صرف العهد"), null, "cross-company sessions cannot collide or resume");
  assert.equal(findConflictingV2Session([{ session: { ...session, id: "other", projectId: "other-project" }, procedureName: "اعتماد صرف العهد" }], session, "اعتماد صرف العهد"), null, "cross-project sessions cannot collide or resume");
  assert.equal(findConflictingV2Session([{ session: { ...session, id: "other", organizationUnitId: "other-unit" }, procedureName: "اعتماد صرف العهد" }], session, "اعتماد صرف العهد"), null, "cross-unit sessions cannot collide or resume");
  assert.equal(findConflictingV2Session([{ session: { ...session, engineVersion: LEGACY_GUIDED_ENGINE_VERSION }, procedureName: "اعتماد صرف العهد" }], session, "اعتماد صرف العهد"), null, "legacy sessions are excluded from V2 name-aware conflicts");
  assert.equal(v2ProjectionAnswers([name], session.id)[0].candidateId, session.id, "V2 conversion adapts session-scoped evidence without persisting a candidate record");
}
