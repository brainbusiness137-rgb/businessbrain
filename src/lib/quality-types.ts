import type { ClarificationItem, DocumentationSession, GuidedAnswer, ProcedureCandidate } from "@/lib/guided-documentation";
import type { PersistedProcedure, PersistedProcedureStep } from "@/lib/procedures";

export const QUALITY_ENGINE_VERSION = "quality-engine.v1";
export const QUALITY_RULESET_VERSION = "quality-ruleset.v1";
export const QUALITY_DIMENSIONS = ["coverage", "structure", "responsibility", "flow_and_outcomes", "timing_and_resources", "controls_and_decisions", "clarity_and_consistency"] as const;
export type QualityDimensionId = typeof QUALITY_DIMENSIONS[number];
export type QualitySeverity = "blocking" | "warning" | "suggestion";
export type QualityState = "needs_completion" | "needs_work" | "eligible_for_review" | "review_improvements_available" | "covered_with_open_points" | "well_covered";
export type QualityFinding = {
  id: string; ruleId: string; ruleVersion: "v1"; dimension: QualityDimensionId; severity: QualitySeverity;
  subject: { type: "session" | "candidate" | "procedure" | "step"; id: string; stepSequence?: number };
  messageKey: string; messageParams?: Record<string, string | number>;
  remediation?: { target: "guided_question" | "clarification" | "candidate" | "procedure_section" | "step"; targetId?: string; questionId?: string; section?: string };
};
export type QualityAssessment = {
  assessmentType: "discovery" | "procedure_detail"; scopeType: "session" | "candidate" | "procedure"; scopeId: string;
  engineVersion: typeof QUALITY_ENGINE_VERSION; ruleSetVersion: typeof QUALITY_RULESET_VERSION; state: QualityState;
  counts: Record<QualitySeverity, number>; coverage?: { applicable: number; answered: number; confirmed: number; uncertain: number };
  dimensions: Array<{ id: QualityDimensionId; blocking: number; warning: number; suggestion: number }>;
  findings: QualityFinding[];
};
export type DiscoveryQualityContext = Readonly<{ session: DocumentationSession; answers: readonly GuidedAnswer[]; candidates: readonly ProcedureCandidate[]; clarifications: readonly ClarificationItem[]; applicableQuestionIds: readonly string[] }>;
export type CandidateQualityContext = Readonly<{ session: DocumentationSession; candidate: ProcedureCandidate; answers: readonly GuidedAnswer[]; clarifications: readonly ClarificationItem[] }>;
export type ProcedureQualityContext = Readonly<{ procedure: PersistedProcedure; steps: readonly PersistedProcedureStep[] }>;
