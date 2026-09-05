import { createHash, randomUUID } from "node:crypto";

import { DURATION_UNITS, ProcedureStepWriteData, ProcedureWriteData } from "@/lib/procedures";
import { isValidFirestoreDocumentId, isValidRequiredString } from "@/lib/request-validation";

const TEXT_LIMIT = 2_000;
const SUMMARY_LIMIT = 500;
const MAX_ITEMS = 100;
const MAX_PAYLOAD = 200_000;

export const GUIDED_ENGINE_VERSION = "guided-v2";
export const LEGACY_GUIDED_ENGINE_VERSION = "guided-v1";
export const DISCOVERY_PROMPT_SET_VERSION = "discovery-v1";
export const SESSION_PHASES = ["discovery", "classification", "documentation", "confirmation", "completed"] as const;
export const SESSION_STATUSES = ["active", "paused", "completed", "abandoned"] as const;
export const SUBJECT_TYPES = ["user", "organization_unit"] as const;
export const CANDIDATE_CLASSIFICATIONS = ["unclassified", "procedure", "task", "step", "duplicate", "unclear"] as const;
export const CANDIDATE_STATUSES = ["discovered", "refining", "confirmed_procedure", "excluded", "converting", "converted"] as const;
export const ANSWER_SUBJECT_TYPES = ["session", "candidate", "step"] as const;
export const CERTAINTIES = ["confirmed", "approximate", "unknown", "conditional", "needs_check"] as const;
export const CLARIFICATION_CATEGORIES = ["unknown", "approximate", "conditional", "needs_check", "missing_reference", "inconsistency", "other"] as const;
export const CLARIFICATION_SEVERITIES = ["required", "recommended"] as const;
export const CLARIFICATION_STATUSES = ["open", "resolved", "dismissed"] as const;

type ValueOf<T extends readonly string[]> = T[number];
export type SessionPhase = ValueOf<typeof SESSION_PHASES>;
export type SessionStatus = ValueOf<typeof SESSION_STATUSES>;
export type CandidateClassification = ValueOf<typeof CANDIDATE_CLASSIFICATIONS>;
export type CandidateStatus = ValueOf<typeof CANDIDATE_STATUSES>;
export type AnswerSubjectType = ValueOf<typeof ANSWER_SUBJECT_TYPES>;
export type Certainty = ValueOf<typeof CERTAINTIES>;
type Json = Record<string, unknown>;

export type GuidedItem = {
  name?: string; description?: string; type?: string; systemName?: string;
  permission?: string; condition?: string; action?: string;
};
export type GuidedAnswerValue =
  | { kind: "text"; value: string }
  | { kind: "choice"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "duration"; value: number; unit: ValueOf<typeof DURATION_UNITS> }
  | { kind: "reference"; referenceType: "user" | "organization_unit"; referenceId: string }
  | { kind: "items"; values: GuidedItem[] };

export type DocumentationSession = {
  id: string; companyId: string; projectId: string; organizationUnitId: string;
  subjectType: ValueOf<typeof SUBJECT_TYPES>; subjectUserId?: string;
  phase: SessionPhase; status: SessionStatus; engineVersion: string;
  discoveryPromptSetVersion: string; active: boolean; currentCandidateId?: string;
  currentQuestionId?: string; createdBy: string; updatedBy: string;
};
export type ProcedureCandidate = {
  id: string; companyId: string; projectId: string; organizationUnitId: string;
  sessionId: string; label: string; classification: CandidateClassification;
  status: CandidateStatus; originQuestionId: string; active: boolean;
  sourceText?: string; relatedCandidateId?: string; exclusionReason?: string;
  procedureId?: string; createdBy: string; updatedBy: string;
};
export type GuidedAnswer = {
  id: string; companyId: string; projectId: string; organizationUnitId: string;
  sessionId: string; subjectType: AnswerSubjectType; subjectKey: string;
  questionId: string; ruleId: string; answer: GuidedAnswerValue; certainty: Certainty;
  active: boolean; answeredBy: string; candidateId?: string; stepKey?: string;
  uncertaintyNote?: string;
};
export type ClarificationItem = {
  id: string; companyId: string; projectId: string; organizationUnitId: string;
  sessionId: string; subjectType: AnswerSubjectType; subjectKey: string;
  questionId: string; category: ValueOf<typeof CLARIFICATION_CATEGORIES>;
  severity: ValueOf<typeof CLARIFICATION_SEVERITIES>; summary: string;
  status: ValueOf<typeof CLARIFICATION_STATUSES>; active: boolean;
  candidateId?: string; stepKey?: string; answerId?: string;
};

export function isResumableV2Session(session: DocumentationSession) {
  return session.engineVersion === GUIDED_ENGINE_VERSION && session.active && ["active", "paused"].includes(session.status);
}
export function normalizeProcedureName(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
export function findConflictingV2Session(sessions: Array<{ session: DocumentationSession | null; procedureName?: string }>, scope: { companyId: string; projectId: string; organizationUnitId: string; subjectType: "user" | "organization_unit"; subjectUserId?: string }, procedureName: string) {
  const normalizedName = normalizeProcedureName(procedureName);
  return sessions.find(({ session, procedureName: persistedName }) => session && persistedName !== undefined && isResumableV2Session(session) && session.companyId === scope.companyId && session.projectId === scope.projectId && session.organizationUnitId === scope.organizationUnitId && session.subjectType === scope.subjectType && session.subjectUserId === scope.subjectUserId && normalizeProcedureName(persistedName) === normalizedName)?.session ?? null;
}

function object(value: unknown): value is Json { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Json, allowed: readonly string[], required: readonly string[] = []) {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key)) && required.every((key) => Object.hasOwn(value, key));
}
function oneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}
function safeSize(value: unknown) { try { return JSON.stringify(value).length <= MAX_PAYLOAD; } catch { return false; } }
function id(value: unknown): value is string { return typeof value === "string" && isValidFirestoreDocumentId(value); }
function optionalText(value: Json, key: string, limit = TEXT_LIMIT): string | null | undefined {
  if (!Object.hasOwn(value, key)) return undefined;
  if (typeof value[key] !== "string") return null;
  const text = value[key].trim();
  return text.length <= limit ? text : null;
}
function timestamp(value: unknown) { return object(value) && typeof value.toDate === "function"; }
function actorPath(value: unknown) {
  if (typeof value !== "string") return false;
  const [collection, documentId, extra] = value.split("/");
  return collection === "users" && extra === undefined && id(documentId);
}

export function createStepKey(sequence?: number) {
  return `${typeof sequence === "number" ? `s${String(sequence).padStart(3, "0")}-` : "s-"}${randomUUID()}`;
}
export function guidedAnswerDocumentId(sessionId: string, subjectKey: string, questionId: string, candidateId?: string) {
  if (!id(sessionId) || !id(subjectKey) || !isValidRequiredString(questionId, 200) || candidateId !== undefined && !id(candidateId)) return null;
  const component = (value: string) => `${Buffer.byteLength(value, "utf8")}:${value}`;
  return createHash("sha256").update(`guided-answer:${component(sessionId)}:${component(candidateId ?? subjectKey)}:${component(subjectKey)}:${component(questionId)}`).digest("hex");
}

export function parseAnswerValue(value: unknown): GuidedAnswerValue | null {
  if (!object(value) || typeof value.kind !== "string") return null;
  if (value.kind === "text" && exact(value, ["kind", "value"], ["kind", "value"]) && isValidRequiredString(value.value, TEXT_LIMIT)) return { kind: "text", value: value.value.trim() };
  if (value.kind === "choice" && exact(value, ["kind", "value"], ["kind", "value"]) && isValidRequiredString(value.value, 200)) return { kind: "choice", value: value.value };
  if (value.kind === "boolean" && exact(value, ["kind", "value"], ["kind", "value"]) && typeof value.value === "boolean") return { kind: "boolean", value: value.value };
  if (value.kind === "number" && exact(value, ["kind", "value"], ["kind", "value"]) && typeof value.value === "number" && Number.isFinite(value.value)) return { kind: "number", value: value.value };
  if (value.kind === "duration" && exact(value, ["kind", "value", "unit"], ["kind", "value", "unit"]) && typeof value.value === "number" && Number.isFinite(value.value) && value.value >= 0 && oneOf(DURATION_UNITS, value.unit)) return { kind: "duration", value: value.value, unit: value.unit };
  if (value.kind === "reference" && exact(value, ["kind", "referenceType", "referenceId"], ["kind", "referenceType", "referenceId"]) && oneOf(["user", "organization_unit"] as const, value.referenceType) && id(value.referenceId)) return { kind: "reference", referenceType: value.referenceType, referenceId: value.referenceId };
  if (value.kind === "items" && exact(value, ["kind", "values"], ["kind", "values"]) && Array.isArray(value.values) && value.values.length <= MAX_ITEMS) {
    const items: GuidedItem[] = [];
    for (const entry of value.values) {
      if (!object(entry) || !exact(entry, ["name", "description", "type", "systemName", "permission", "condition", "action"])) return null;
      const parsed: GuidedItem = {};
      for (const key of ["name", "description", "type", "systemName", "permission", "condition", "action"] as const) {
        if (Object.hasOwn(entry, key)) {
          if (typeof entry[key] !== "string" || entry[key].trim().length === 0 || entry[key].trim().length > TEXT_LIMIT) return null;
          parsed[key] = entry[key].trim();
        }
      }
      if (Object.keys(parsed).length === 0) return null;
      items.push(parsed);
    }
    return { kind: "items", values: items };
  }
  return null;
}

export function parseSessionCreate(value: unknown) {
  if (!object(value) || !safeSize(value) || !exact(value, ["companyId", "projectId", "organizationUnitId", "subjectType", "subjectUserId", "procedureName"], ["companyId", "projectId", "organizationUnitId", "subjectType", "procedureName"]) || !id(value.companyId) || !id(value.projectId) || !id(value.organizationUnitId) || !oneOf(SUBJECT_TYPES, value.subjectType) || !isValidRequiredString(value.procedureName, 200)) return null;
  if (value.subjectType === "user" ? !id(value.subjectUserId) : Object.hasOwn(value, "subjectUserId")) return null;
  return { companyId: value.companyId, projectId: value.projectId, organizationUnitId: value.organizationUnitId, subjectType: value.subjectType, procedureName: value.procedureName.trim(), ...(typeof value.subjectUserId === "string" ? { subjectUserId: value.subjectUserId } : {}) };
}

export function parseCandidateCreate(value: unknown) {
  if (!object(value) || !safeSize(value) || !exact(value, ["sessionId", "label", "sourceText", "originQuestionId"], ["sessionId", "label", "originQuestionId"]) || !id(value.sessionId) || !isValidRequiredString(value.label, 200) || !isValidRequiredString(value.originQuestionId, 200)) return null;
  const sourceText = optionalText(value, "sourceText"); if (sourceText === null) return null;
  const sessionId = value.sessionId as string; const label = value.label as string; const originQuestionId = value.originQuestionId as string;
  return { sessionId, label: label.trim(), originQuestionId, ...(sourceText !== undefined ? { sourceText } : {}) };
}

export function parseAnswerSubmission(value: unknown) {
  if (!object(value) || !safeSize(value) || !exact(value, ["sessionId", "candidateId", "subjectType", "subjectKey", "stepKey", "questionId", "answer", "certainty", "uncertaintyNote"], ["sessionId", "subjectType", "subjectKey", "questionId", "answer", "certainty"]) || !id(value.sessionId) || !oneOf(ANSWER_SUBJECT_TYPES, value.subjectType) || !id(value.subjectKey) || !isValidRequiredString(value.questionId, 200) || !oneOf(CERTAINTIES, value.certainty)) return null;
  if (Object.hasOwn(value, "candidateId") && !id(value.candidateId)) return null;
  if (value.subjectType === "session" && Object.hasOwn(value, "candidateId")) return null;
  if (value.subjectType === "step" && (!id(value.stepKey) || value.stepKey !== value.subjectKey)) return null;
  if (value.subjectType !== "step" && Object.hasOwn(value, "stepKey")) return null;
  const answer = parseAnswerValue(value.answer); const note = optionalText(value, "uncertaintyNote");
  if (!answer || note === null || (value.certainty !== "confirmed" && !note && value.certainty !== "unknown")) return null;
  const sessionId = value.sessionId as string; const subjectKey = value.subjectKey as string; const questionId = value.questionId as string;
  return { sessionId, subjectType: value.subjectType, subjectKey, questionId, answer, certainty: value.certainty, ...(typeof value.candidateId === "string" ? { candidateId: value.candidateId } : {}), ...(typeof value.stepKey === "string" ? { stepKey: value.stepKey } : {}), ...(note !== undefined ? { uncertaintyNote: note } : {}) };
}

export function resolveAnswerSubmissionIdentity(session: DocumentationSession, input: NonNullable<ReturnType<typeof parseAnswerSubmission>>, questionSubjectType: AnswerSubjectType) {
  if (input.subjectType !== questionSubjectType) return null;
  if (session.engineVersion === GUIDED_ENGINE_VERSION) {
    if (input.candidateId !== undefined || input.subjectType === "session" || input.subjectType === "candidate" && input.subjectKey !== session.id) return null;
    return { effectiveCandidateId: session.id };
  }
  if (input.subjectType === "candidate" || input.subjectType === "step") return input.candidateId ? { effectiveCandidateId: input.candidateId } : null;
  return input.subjectKey === session.id && input.candidateId === undefined ? { effectiveCandidateId: undefined } : null;
}

const auditFields = ["createdBy", "updatedBy", "createdAt", "updatedAt"];
export function parsePersistedSession(documentId: string, data: Json | undefined): DocumentationSession | null {
  if (!id(documentId) || !data || !exact(data, ["companyId", "projectId", "organizationUnitId", "subjectType", "subjectUserId", "phase", "status", "engineVersion", "discoveryPromptSetVersion", "active", "currentCandidateId", "currentQuestionId", "discoveryCompletedAt", "completedAt", "abandonedReason", "lastActivityAt", ...auditFields], ["companyId", "projectId", "organizationUnitId", "subjectType", "phase", "status", "engineVersion", "discoveryPromptSetVersion", "active", "lastActivityAt", ...auditFields]) || !id(data.companyId) || !id(data.projectId) || !id(data.organizationUnitId) || !oneOf(SUBJECT_TYPES, data.subjectType) || !oneOf(SESSION_PHASES, data.phase) || !oneOf(SESSION_STATUSES, data.status) || typeof data.engineVersion !== "string" || typeof data.discoveryPromptSetVersion !== "string" || typeof data.active !== "boolean" || !actorPath(data.createdBy) || !actorPath(data.updatedBy) || !timestamp(data.createdAt) || !timestamp(data.updatedAt) || !timestamp(data.lastActivityAt)) return null;
  if (data.subjectType === "user" ? !id(data.subjectUserId) : Object.hasOwn(data, "subjectUserId")) return null;
  if ((data.status === "completed" || data.status === "abandoned") === data.active || (data.phase === "completed") !== (data.status === "completed")) return null;
  for (const key of ["currentCandidateId"] as const) if (Object.hasOwn(data, key) && !id(data[key])) return null;
  if (Object.hasOwn(data, "currentQuestionId") && !isValidRequiredString(data.currentQuestionId, 200)) return null;
  for (const key of ["discoveryCompletedAt", "completedAt"] as const) if (Object.hasOwn(data, key) && !timestamp(data[key])) return null;
  const abandonedReason = optionalText(data, "abandonedReason"); if (abandonedReason === null) return null;
  if ((data.status === "completed" ? !Object.hasOwn(data, "completedAt") : Object.hasOwn(data, "completedAt")) || (data.status === "abandoned" ? !abandonedReason : Object.hasOwn(data, "abandonedReason"))) return null;
  return { id: documentId, companyId: data.companyId as string, projectId: data.projectId as string, organizationUnitId: data.organizationUnitId as string, subjectType: data.subjectType, ...(typeof data.subjectUserId === "string" ? { subjectUserId: data.subjectUserId } : {}), phase: data.phase, status: data.status, engineVersion: data.engineVersion, discoveryPromptSetVersion: data.discoveryPromptSetVersion, active: data.active, ...(typeof data.currentCandidateId === "string" ? { currentCandidateId: data.currentCandidateId } : {}), ...(typeof data.currentQuestionId === "string" ? { currentQuestionId: data.currentQuestionId } : {}), createdBy: data.createdBy as string, updatedBy: data.updatedBy as string };
}

export function parsePersistedCandidate(documentId: string, data: Json | undefined): ProcedureCandidate | null {
  if (!id(documentId) || !data || !exact(data, ["companyId", "projectId", "organizationUnitId", "sessionId", "label", "classification", "status", "originQuestionId", "active", "sourceText", "relatedCandidateId", "exclusionReason", "procedureId", "convertedAt", "convertedBy", ...auditFields], ["companyId", "projectId", "organizationUnitId", "sessionId", "label", "classification", "status", "originQuestionId", "active", ...auditFields]) || !id(data.companyId) || !id(data.projectId) || !id(data.organizationUnitId) || !id(data.sessionId) || !isValidRequiredString(data.label, 200) || !oneOf(CANDIDATE_CLASSIFICATIONS, data.classification) || !oneOf(CANDIDATE_STATUSES, data.status) || !isValidRequiredString(data.originQuestionId, 200) || typeof data.active !== "boolean" || !actorPath(data.createdBy) || !actorPath(data.updatedBy) || !timestamp(data.createdAt) || !timestamp(data.updatedAt)) return null;
  if (data.status === "converted" ? (!id(data.procedureId) || !timestamp(data.convertedAt) || !actorPath(data.convertedBy)) : Object.hasOwn(data, "procedureId") || Object.hasOwn(data, "convertedAt") || Object.hasOwn(data, "convertedBy")) return null;
  if (["converted", "excluded"].includes(data.status) === data.active) return null;
  for (const key of ["sourceText", "exclusionReason"] as const) if (optionalText(data, key) === null) return null;
  if (Object.hasOwn(data, "relatedCandidateId") && !id(data.relatedCandidateId)) return null;
  return { id: documentId, companyId: data.companyId as string, projectId: data.projectId as string, organizationUnitId: data.organizationUnitId as string, sessionId: data.sessionId as string, label: (data.label as string).trim(), classification: data.classification, status: data.status, originQuestionId: data.originQuestionId as string, active: data.active, ...(typeof data.sourceText === "string" ? { sourceText: data.sourceText.trim() } : {}), ...(typeof data.relatedCandidateId === "string" ? { relatedCandidateId: data.relatedCandidateId } : {}), ...(typeof data.exclusionReason === "string" ? { exclusionReason: data.exclusionReason.trim() } : {}), ...(typeof data.procedureId === "string" ? { procedureId: data.procedureId } : {}), createdBy: data.createdBy as string, updatedBy: data.updatedBy as string };
}

export function parsePersistedAnswer(documentId: string, data: Json | undefined): GuidedAnswer | null {
  if (!id(documentId) || !data || !exact(data, ["companyId", "projectId", "organizationUnitId", "sessionId", "subjectType", "subjectKey", "questionId", "ruleId", "answer", "certainty", "active", "answeredBy", "candidateId", "stepKey", "uncertaintyNote", "supersededAt", "createdAt", "updatedAt"], ["companyId", "projectId", "organizationUnitId", "sessionId", "subjectType", "subjectKey", "questionId", "ruleId", "answer", "certainty", "active", "answeredBy", "createdAt", "updatedAt"]) || !id(data.companyId) || !id(data.projectId) || !id(data.organizationUnitId) || !id(data.sessionId) || !oneOf(ANSWER_SUBJECT_TYPES, data.subjectType) || !id(data.subjectKey) || !isValidRequiredString(data.questionId, 200) || !isValidRequiredString(data.ruleId, 200) || !oneOf(CERTAINTIES, data.certainty) || typeof data.active !== "boolean" || !actorPath(data.answeredBy) || !timestamp(data.createdAt) || !timestamp(data.updatedAt)) return null;
  const answer = parseAnswerValue(data.answer); if (!answer || guidedAnswerDocumentId(data.sessionId as string, data.subjectKey as string, data.questionId as string, typeof data.candidateId === "string" ? data.candidateId : undefined) !== documentId) return null;
  if ((data.subjectType === "candidate" || data.subjectType === "step") && !id(data.candidateId)) return null;
  if (data.subjectType === "session" && Object.hasOwn(data, "candidateId")) return null;
  if (data.subjectType !== "step" && Object.hasOwn(data, "stepKey")) return null;
  if (data.subjectType === "step" && (!id(data.stepKey) || data.stepKey !== data.subjectKey)) return null;
  const uncertaintyNote = optionalText(data, "uncertaintyNote"); if (uncertaintyNote === null || Object.hasOwn(data, "supersededAt") && !timestamp(data.supersededAt)) return null;
  return { id: documentId, companyId: data.companyId as string, projectId: data.projectId as string, organizationUnitId: data.organizationUnitId as string, sessionId: data.sessionId as string, subjectType: data.subjectType, subjectKey: data.subjectKey as string, questionId: data.questionId as string, ruleId: data.ruleId as string, answer, certainty: data.certainty, active: data.active, answeredBy: data.answeredBy as string, ...(typeof data.candidateId === "string" ? { candidateId: data.candidateId } : {}), ...(typeof data.stepKey === "string" ? { stepKey: data.stepKey } : {}), ...(uncertaintyNote !== undefined ? { uncertaintyNote } : {}) };
}

export function parsePersistedClarification(documentId: string, data: Json | undefined): ClarificationItem | null {
  if (!id(documentId) || !data || !exact(data, ["companyId", "projectId", "organizationUnitId", "sessionId", "subjectType", "subjectKey", "questionId", "category", "severity", "summary", "status", "active", "candidateId", "stepKey", "answerId", "resolutionAnswerId", "resolutionNote", "resolvedAt", ...auditFields], ["companyId", "projectId", "organizationUnitId", "sessionId", "subjectType", "subjectKey", "questionId", "category", "severity", "summary", "status", "active", ...auditFields]) || !id(data.companyId) || !id(data.projectId) || !id(data.organizationUnitId) || !id(data.sessionId) || !oneOf(ANSWER_SUBJECT_TYPES, data.subjectType) || !id(data.subjectKey) || !isValidRequiredString(data.questionId, 200) || !oneOf(CLARIFICATION_CATEGORIES, data.category) || !oneOf(CLARIFICATION_SEVERITIES, data.severity) || !isValidRequiredString(data.summary, SUMMARY_LIMIT) || !oneOf(CLARIFICATION_STATUSES, data.status) || typeof data.active !== "boolean" || !actorPath(data.createdBy) || !actorPath(data.updatedBy) || !timestamp(data.createdAt) || !timestamp(data.updatedAt)) return null;
  if ((data.subjectType === "candidate" || data.subjectType === "step") && !id(data.candidateId) || data.subjectType === "session" && Object.hasOwn(data, "candidateId") || data.subjectType === "step" && (!id(data.stepKey) || data.stepKey !== data.subjectKey) || data.subjectType !== "step" && Object.hasOwn(data, "stepKey")) return null;
  for (const key of ["answerId", "resolutionAnswerId"] as const) if (Object.hasOwn(data, key) && !id(data[key])) return null;
  const resolutionNote = optionalText(data, "resolutionNote"); if (resolutionNote === null || Object.hasOwn(data, "resolvedAt") && !timestamp(data.resolvedAt)) return null;
  if ((data.status === "open") !== data.active) return null;
  if (data.status === "open" && ["resolutionAnswerId", "resolutionNote", "resolvedAt"].some((key) => Object.hasOwn(data, key)) || data.status === "resolved" && (!id(data.resolutionAnswerId) || !timestamp(data.resolvedAt)) || data.status === "dismissed" && (!resolutionNote || !timestamp(data.resolvedAt) || Object.hasOwn(data, "resolutionAnswerId"))) return null;
  return { id: documentId, companyId: data.companyId as string, projectId: data.projectId as string, organizationUnitId: data.organizationUnitId as string, sessionId: data.sessionId as string, subjectType: data.subjectType, subjectKey: data.subjectKey as string, questionId: data.questionId as string, category: data.category, severity: data.severity, summary: (data.summary as string).trim(), status: data.status, active: data.active, ...(typeof data.candidateId === "string" ? { candidateId: data.candidateId } : {}), ...(typeof data.stepKey === "string" ? { stepKey: data.stepKey } : {}), ...(typeof data.answerId === "string" ? { answerId: data.answerId } : {}) };
}

export function sameScope(child: { companyId: string; projectId: string; organizationUnitId: string; sessionId?: string }, session: DocumentationSession) {
  return child.companyId === session.companyId && child.projectId === session.projectId && child.organizationUnitId === session.organizationUnitId && (!child.sessionId || child.sessionId === session.id);
}

export type GuidedProjection = { procedure: ProcedureWriteData; steps: ProcedureStepWriteData[] };
