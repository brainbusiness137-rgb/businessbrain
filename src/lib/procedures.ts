import {
  isValidFirestoreDocumentId,
  isValidRequiredString,
} from "@/lib/request-validation";

const SHORT_TEXT_LIMIT = 200;
const LONG_TEXT_LIMIT = 2_000;
const DESCRIPTION_LIMIT = 5_000;
const MAX_ITEMS = 100;
const MAX_PAYLOAD_CHARACTERS = 200_000;

export const PROCEDURE_STATUSES = [
  "draft",
  "in_progress",
  "ready_for_review",
] as const;
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number];

export const TRIGGER_TYPES = [
  "scheduled",
  "event",
  "request",
  "condition",
  "other",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const FREQUENCY_TYPES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "event_driven",
  "on_demand",
  "irregular",
  "other",
] as const;
export type FrequencyType = (typeof FREQUENCY_TYPES)[number];

export const DURATION_UNITS = [
  "minutes",
  "hours",
  "days",
  "business_days",
] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const PERFORMER_TYPES = [
  "user",
  "role",
  "organization_unit",
  "external",
  "other",
] as const;
export type PerformerType = (typeof PERFORMER_TYPES)[number];

export const DOCUMENT_TYPES = [
  "form",
  "document",
  "report",
  "spreadsheet",
  "email",
  "invoice",
  "request",
  "other",
] as const;
export type ProcedureDocumentType = (typeof DOCUMENT_TYPES)[number];

export type Trigger = { type: TriggerType; description?: string };
export type Frequency = {
  type: FrequencyType;
  interval?: number;
  description?: string;
};
export type NamedItem = { name: string; description?: string };
export type Duration = { value: number; unit: DurationUnit };
export type Timing = {
  processing?: Duration;
  waiting?: Duration;
  lead?: Duration;
};
export type Performer = {
  type: PerformerType;
  userId?: string;
  role?: string;
  description?: string;
};
export type ProcedureDocument = NamedItem & { type: ProcedureDocumentType };
export type PolicyReference = NamedItem & { reference?: string };
export type RequiredSystemPermission = {
  systemName: string;
  permission: string;
  description?: string;
};
export type OperationalReview = {
  required: boolean;
  performer?: Performer;
  description?: string;
};
export type OperationalApproval = {
  required: boolean;
  performer?: Performer;
  condition?: string;
  rejectionAction?: string;
};
export type Decision = {
  isDecision: boolean;
  question?: string;
  description?: string;
};
export type ProcedureException = {
  condition: string;
  action: string;
  description?: string;
};

export type ProcedureWriteData = {
  companyId: string;
  projectId: string;
  organizationUnitId: string;
  name: string;
  objective: string;
  trigger: Trigger;
  frequency: Frequency;
  status: ProcedureStatus;
  active: boolean;
  description?: string;
  inputs?: NamedItem[];
  outputs?: NamedItem[];
  timing?: Timing;
};

export type ProcedurePatchData = Partial<
  Omit<ProcedureWriteData, "companyId" | "projectId">
> & { procedureId: string };

export type PersistedProcedure = ProcedureWriteData & { id: string };

export type ProcedureStepWriteData = {
  companyId: string;
  projectId: string;
  procedureId: string;
  sequence: number;
  name: string;
  active: boolean;
  description?: string;
  performer?: Performer;
  organizationUnitId?: string;
  inputs?: NamedItem[];
  outputs?: NamedItem[];
  timing?: Timing;
  systems?: NamedItem[];
  documents?: ProcedureDocument[];
  policies?: PolicyReference[];
  requiredPermissions?: RequiredSystemPermission[];
  review?: OperationalReview;
  approval?: OperationalApproval;
  decision?: Decision;
  exceptions?: ProcedureException[];
};

export type ProcedureStepPatchData = Partial<
  Omit<
    ProcedureStepWriteData,
    "companyId" | "projectId" | "procedureId"
  >
> & { stepId: string };

export type PersistedProcedureStep = ProcedureStepWriteData & { id: string };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSafePayloadSize(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= MAX_PAYLOAD_CHARACTERS;
  } catch {
    return false;
  }
}

function exactFields(
  value: JsonObject,
  allowed: readonly string[],
  required: readonly string[] = []
): boolean {
  const allowedSet = new Set(allowed);
  return (
    Object.keys(value).every((key) => allowedSet.has(key)) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}

function isEnumValue<T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function optionalText(
  value: JsonObject,
  key: string,
  limit = LONG_TEXT_LIMIT
): string | undefined | null {
  if (!Object.hasOwn(value, key)) return undefined;
  if (typeof value[key] !== "string") return null;
  const result = value[key].trim();
  return result.length <= limit ? result : null;
}

function parseTrigger(value: unknown): Trigger | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["type", "description"], ["type"]) ||
    !isEnumValue(TRIGGER_TYPES, value.type)
  ) return null;
  const description = optionalText(value, "description");
  if (description === null) return null;
  return { type: value.type, ...(description !== undefined ? { description } : {}) };
}

function parseFrequency(value: unknown): Frequency | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["type", "interval", "description"], ["type"]) ||
    !isEnumValue(FREQUENCY_TYPES, value.type) ||
    (Object.hasOwn(value, "interval") &&
      (typeof value.interval !== "number" ||
        !Number.isFinite(value.interval) ||
        value.interval <= 0))
  ) return null;
  const description = optionalText(value, "description");
  if (description === null) return null;
  return {
    type: value.type,
    ...(typeof value.interval === "number" ? { interval: value.interval } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseNamedItem(value: unknown): NamedItem | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["name", "description"], ["name"]) ||
    !isValidRequiredString(value.name, SHORT_TEXT_LIMIT)
  ) return null;
  const description = optionalText(value, "description");
  if (description === null) return null;
  return {
    name: value.name.trim(),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseArray<T>(
  value: unknown,
  parser: (entry: unknown) => T | null
): T[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const result: T[] = [];
  for (const entry of value) {
    const parsed = parser(entry);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

function parseDuration(value: unknown): Duration | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["value", "unit"], ["value", "unit"]) ||
    typeof value.value !== "number" ||
    !Number.isFinite(value.value) ||
    value.value < 0 ||
    !isEnumValue(DURATION_UNITS, value.unit)
  ) return null;
  return { value: value.value, unit: value.unit };
}

function parseTiming(value: unknown): Timing | null {
  if (!isObject(value) || !exactFields(value, ["processing", "waiting", "lead"])) {
    return null;
  }
  const result: Timing = {};
  for (const key of ["processing", "waiting", "lead"] as const) {
    if (Object.hasOwn(value, key)) {
      const duration = parseDuration(value[key]);
      if (!duration) return null;
      result[key] = duration;
    }
  }
  return result;
}

export function parsePerformer(value: unknown): Performer | null {
  if (!isObject(value) || !isEnumValue(PERFORMER_TYPES, value.type)) return null;
  const common = ["type", "description"];
  const allowed = value.type === "user"
    ? [...common, "userId"]
    : value.type === "role"
      ? [...common, "role"]
      : common;
  if (!exactFields(value, allowed, ["type"])) return null;
  const description = optionalText(value, "description");
  if (description === null) return null;

  if (
    value.type === "user" &&
    (typeof value.userId !== "string" || !isValidFirestoreDocumentId(value.userId))
  ) return null;
  if (value.type === "role" && !isValidRequiredString(value.role, SHORT_TEXT_LIMIT)) {
    return null;
  }
  if (
    (value.type === "external" || value.type === "other") &&
    (description === undefined || description.length === 0)
  ) return null;

  return {
    type: value.type,
    ...(typeof value.userId === "string" ? { userId: value.userId } : {}),
    ...(typeof value.role === "string" ? { role: value.role.trim() } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseDocument(value: unknown): ProcedureDocument | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["name", "type", "description"], ["name", "type"]) ||
    !isValidRequiredString(value.name, SHORT_TEXT_LIMIT) ||
    !isEnumValue(DOCUMENT_TYPES, value.type)
  ) return null;
  const description = optionalText(value, "description");
  if (description === null) return null;
  return {
    name: value.name.trim(),
    type: value.type,
    ...(description !== undefined ? { description } : {}),
  };
}

function parsePolicy(value: unknown): PolicyReference | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["name", "reference", "description"], ["name"]) ||
    !isValidRequiredString(value.name, SHORT_TEXT_LIMIT)
  ) return null;
  const reference = optionalText(value, "reference", SHORT_TEXT_LIMIT);
  const description = optionalText(value, "description");
  if (reference === null || description === null) return null;
  return {
    name: value.name.trim(),
    ...(reference !== undefined ? { reference } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseRequiredPermission(value: unknown): RequiredSystemPermission | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["systemName", "permission", "description"], ["systemName", "permission"]) ||
    !isValidRequiredString(value.systemName, SHORT_TEXT_LIMIT) ||
    !isValidRequiredString(value.permission, SHORT_TEXT_LIMIT)
  ) return null;
  const description = optionalText(value, "description");
  if (description === null) return null;
  return {
    systemName: value.systemName.trim(),
    permission: value.permission.trim(),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseReview(value: unknown): OperationalReview | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["required", "performer", "description"], ["required"]) ||
    typeof value.required !== "boolean"
  ) return null;
  const performer = Object.hasOwn(value, "performer")
    ? parsePerformer(value.performer)
    : undefined;
  const description = optionalText(value, "description");
  if (performer === null || description === null || (value.required && !performer)) {
    return null;
  }
  return {
    required: value.required,
    ...(performer ? { performer } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseApproval(value: unknown): OperationalApproval | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["required", "performer", "condition", "rejectionAction"], ["required"]) ||
    typeof value.required !== "boolean"
  ) return null;
  const performer = Object.hasOwn(value, "performer")
    ? parsePerformer(value.performer)
    : undefined;
  const condition = optionalText(value, "condition");
  const rejectionAction = optionalText(value, "rejectionAction");
  if (
    performer === null ||
    condition === null ||
    rejectionAction === null ||
    (value.required && !performer)
  ) return null;
  return {
    required: value.required,
    ...(performer ? { performer } : {}),
    ...(condition !== undefined ? { condition } : {}),
    ...(rejectionAction !== undefined ? { rejectionAction } : {}),
  };
}

function parseDecision(value: unknown): Decision | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["isDecision", "question", "description"], ["isDecision"]) ||
    typeof value.isDecision !== "boolean"
  ) return null;
  const question = optionalText(value, "question");
  const description = optionalText(value, "description");
  if (
    question === null ||
    description === null ||
    (value.isDecision && (!question || question.length === 0))
  ) return null;
  return {
    isDecision: value.isDecision,
    ...(question !== undefined ? { question } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseException(value: unknown): ProcedureException | null {
  if (
    !isObject(value) ||
    !exactFields(value, ["condition", "action", "description"], ["condition", "action"]) ||
    !isValidRequiredString(value.condition, LONG_TEXT_LIMIT) ||
    !isValidRequiredString(value.action, LONG_TEXT_LIMIT)
  ) return null;
  const description = optionalText(value, "description");
  if (description === null) return null;
  return {
    condition: value.condition.trim(),
    action: value.action.trim(),
    ...(description !== undefined ? { description } : {}),
  };
}

function optionalParsed<T>(
  source: JsonObject,
  key: string,
  parser: (value: unknown) => T | null,
  target: Record<string, unknown>
): boolean {
  if (!Object.hasOwn(source, key)) return true;
  const parsed = parser(source[key]);
  if (parsed === null) return false;
  target[key] = parsed;
  return true;
}

const PROCEDURE_FIELDS = [
  "companyId", "projectId", "organizationUnitId", "name", "objective",
  "trigger", "frequency", "status", "active", "description", "inputs",
  "outputs", "timing",
] as const;

export function parseProcedureCreateInput(value: unknown): ProcedureWriteData | null {
  if (
    !isObject(value) ||
    !hasSafePayloadSize(value) ||
    !exactFields(value, PROCEDURE_FIELDS, [
      "companyId", "projectId", "organizationUnitId", "name", "objective",
      "trigger", "frequency", "status", "active",
    ]) ||
    typeof value.companyId !== "string" ||
    !isValidFirestoreDocumentId(value.companyId) ||
    typeof value.projectId !== "string" ||
    !isValidFirestoreDocumentId(value.projectId) ||
    typeof value.organizationUnitId !== "string" ||
    !isValidFirestoreDocumentId(value.organizationUnitId) ||
    !isValidRequiredString(value.name, SHORT_TEXT_LIMIT) ||
    !isValidRequiredString(value.objective, LONG_TEXT_LIMIT) ||
    !isEnumValue(PROCEDURE_STATUSES, value.status) ||
    typeof value.active !== "boolean"
  ) return null;
  const trigger = parseTrigger(value.trigger);
  const frequency = parseFrequency(value.frequency);
  const description = optionalText(value, "description", DESCRIPTION_LIMIT);
  if (!trigger || !frequency || description === null) return null;

  const result: ProcedureWriteData = {
    companyId: value.companyId,
    projectId: value.projectId,
    organizationUnitId: value.organizationUnitId,
    name: value.name.trim(),
    objective: value.objective.trim(),
    trigger,
    frequency,
    status: value.status,
    active: value.active,
    ...(description !== undefined ? { description } : {}),
  };
  if (
    !optionalParsed(value, "inputs", (entry) => parseArray(entry, parseNamedItem), result as unknown as Record<string, unknown>) ||
    !optionalParsed(value, "outputs", (entry) => parseArray(entry, parseNamedItem), result as unknown as Record<string, unknown>) ||
    !optionalParsed(value, "timing", parseTiming, result as unknown as Record<string, unknown>)
  ) return null;
  return result;
}

export function parseProcedurePatchInput(value: unknown): ProcedurePatchData | null {
  if (
    !isObject(value) ||
    !hasSafePayloadSize(value) ||
    !exactFields(value, ["procedureId", ...PROCEDURE_FIELDS.filter((field) => field !== "companyId" && field !== "projectId")], ["procedureId"]) ||
    typeof value.procedureId !== "string" ||
    !isValidFirestoreDocumentId(value.procedureId) ||
    Object.keys(value).length === 1
  ) return null;
  const synthetic: JsonObject = {
    companyId: "validation-company",
    projectId: "validation-project",
    organizationUnitId: Object.hasOwn(value, "organizationUnitId")
      ? value.organizationUnitId : "validation-unit",
    name: Object.hasOwn(value, "name") ? value.name : "validation-name",
    objective: Object.hasOwn(value, "objective")
      ? value.objective : "validation-objective",
    trigger: Object.hasOwn(value, "trigger") ? value.trigger : { type: "other" },
    frequency: Object.hasOwn(value, "frequency")
      ? value.frequency : { type: "other" },
    status: Object.hasOwn(value, "status") ? value.status : "draft",
    active: Object.hasOwn(value, "active") ? value.active : true,
  };
  for (const field of ["description", "inputs", "outputs", "timing"] as const) {
    if (Object.hasOwn(value, field)) synthetic[field] = value[field];
  }
  const parsed = parseProcedureCreateInput(synthetic);
  if (!parsed) return null;
  const result: ProcedurePatchData = { procedureId: value.procedureId };
  for (const field of PROCEDURE_FIELDS) {
    if (field !== "companyId" && field !== "projectId" && Object.hasOwn(value, field)) {
      (result as Record<string, unknown>)[field] = parsed[field];
    }
  }
  return result;
}

const STEP_FIELDS = [
  "companyId", "projectId", "procedureId", "sequence", "name", "active",
  "description", "performer", "organizationUnitId", "inputs", "outputs",
  "timing", "systems", "documents", "policies", "requiredPermissions",
  "review", "approval", "decision", "exceptions",
] as const;

export function parseProcedureStepCreateInput(value: unknown): ProcedureStepWriteData | null {
  if (
    !isObject(value) ||
    !hasSafePayloadSize(value) ||
    !exactFields(value, STEP_FIELDS, ["companyId", "projectId", "procedureId", "sequence", "name", "active"]) ||
    typeof value.companyId !== "string" || !isValidFirestoreDocumentId(value.companyId) ||
    typeof value.projectId !== "string" || !isValidFirestoreDocumentId(value.projectId) ||
    typeof value.procedureId !== "string" || !isValidFirestoreDocumentId(value.procedureId) ||
    typeof value.sequence !== "number" || !Number.isFinite(value.sequence) ||
    !Number.isInteger(value.sequence) || value.sequence <= 0 ||
    !isValidRequiredString(value.name, SHORT_TEXT_LIMIT) ||
    typeof value.active !== "boolean" ||
    (Object.hasOwn(value, "organizationUnitId") &&
      (typeof value.organizationUnitId !== "string" || !isValidFirestoreDocumentId(value.organizationUnitId)))
  ) return null;
  const description = optionalText(value, "description", DESCRIPTION_LIMIT);
  if (description === null) return null;
  const result: ProcedureStepWriteData = {
    companyId: value.companyId,
    projectId: value.projectId,
    procedureId: value.procedureId,
    sequence: value.sequence,
    name: value.name.trim(),
    active: value.active,
    ...(description !== undefined ? { description } : {}),
    ...(typeof value.organizationUnitId === "string" ? { organizationUnitId: value.organizationUnitId } : {}),
  };
  const parsers: Array<[string, (entry: unknown) => unknown | null]> = [
    ["performer", parsePerformer],
    ["inputs", (entry) => parseArray(entry, parseNamedItem)],
    ["outputs", (entry) => parseArray(entry, parseNamedItem)],
    ["timing", parseTiming],
    ["systems", (entry) => parseArray(entry, parseNamedItem)],
    ["documents", (entry) => parseArray(entry, parseDocument)],
    ["policies", (entry) => parseArray(entry, parsePolicy)],
    ["requiredPermissions", (entry) => parseArray(entry, parseRequiredPermission)],
    ["review", parseReview],
    ["approval", parseApproval],
    ["decision", parseDecision],
    ["exceptions", (entry) => parseArray(entry, parseException)],
  ];
  for (const [key, parser] of parsers) {
    if (!optionalParsed(value, key, parser, result as unknown as Record<string, unknown>)) return null;
  }
  for (const holder of [result.performer, result.review?.performer, result.approval?.performer]) {
    if (holder?.type === "organization_unit" && !result.organizationUnitId) return null;
  }
  return result;
}

export function parseProcedureStepPatchInput(value: unknown): ProcedureStepPatchData | null {
  if (
    !isObject(value) ||
    !hasSafePayloadSize(value) ||
    !exactFields(value, ["stepId", ...STEP_FIELDS.filter((field) => !["companyId", "projectId", "procedureId"].includes(field))], ["stepId"]) ||
    typeof value.stepId !== "string" ||
    !isValidFirestoreDocumentId(value.stepId) ||
    Object.keys(value).length === 1
  ) return null;
  const synthetic: JsonObject = {
    companyId: "validation-company",
    projectId: "validation-project",
    procedureId: "validation-procedure",
    sequence: Object.hasOwn(value, "sequence") ? value.sequence : 1,
    name: Object.hasOwn(value, "name") ? value.name : "validation-name",
    active: Object.hasOwn(value, "active") ? value.active : true,
    organizationUnitId: Object.hasOwn(value, "organizationUnitId")
      ? value.organizationUnitId : "validation-unit",
  };
  for (const field of STEP_FIELDS) {
    if (!["companyId", "projectId", "procedureId", "sequence", "name", "active"].includes(field) && Object.hasOwn(value, field)) {
      synthetic[field] = value[field];
    }
  }
  if (Object.hasOwn(value, "organizationUnitId")) synthetic.organizationUnitId = value.organizationUnitId;
  const parsed = parseProcedureStepCreateInput(synthetic);
  if (!parsed) return null;
  const result: ProcedureStepPatchData = { stepId: value.stepId };
  for (const field of STEP_FIELDS) {
    if (!["companyId", "projectId", "procedureId"].includes(field) && Object.hasOwn(value, field)) {
      (result as Record<string, unknown>)[field] = parsed[field];
    }
  }
  return result;
}

function isTimestamp(value: unknown): boolean {
  return typeof value === "object" && value !== null && "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function";
}

function isTenantActorPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [collection, documentId, extra] = value.split("/");
  return collection === "users" && extra === undefined && isValidFirestoreDocumentId(documentId);
}

export function parsePersistedProcedure(
  documentId: string,
  data: Record<string, unknown> | undefined
): PersistedProcedure | null {
  const auditFields = ["createdBy", "updatedBy", "createdAt", "updatedAt"];
  if (
    !isValidFirestoreDocumentId(documentId) || !data ||
    !exactFields(data, [...PROCEDURE_FIELDS, ...auditFields], [
      "companyId", "projectId", "organizationUnitId", "name", "objective",
      "trigger", "frequency", "status", "active", ...auditFields,
    ]) ||
    !isTenantActorPath(data.createdBy) || !isTenantActorPath(data.updatedBy) ||
    !isTimestamp(data.createdAt) || !isTimestamp(data.updatedAt)
  ) return null;
  const payload: JsonObject = {};
  for (const field of PROCEDURE_FIELDS) if (Object.hasOwn(data, field)) payload[field] = data[field];
  const parsed = parseProcedureCreateInput(payload);
  return parsed ? { id: documentId, ...parsed } : null;
}

export function parsePersistedProcedureStep(
  documentId: string,
  data: Record<string, unknown> | undefined
): PersistedProcedureStep | null {
  const auditFields = ["createdBy", "updatedBy", "createdAt", "updatedAt"];
  if (
    !isValidFirestoreDocumentId(documentId) || !data ||
    !exactFields(data, [...STEP_FIELDS, ...auditFields], [
      "companyId", "projectId", "procedureId", "sequence", "name", "active",
      ...auditFields,
    ]) ||
    !isTenantActorPath(data.createdBy) || !isTenantActorPath(data.updatedBy) ||
    !isTimestamp(data.createdAt) || !isTimestamp(data.updatedAt)
  ) return null;
  const payload: JsonObject = {};
  for (const field of STEP_FIELDS) if (Object.hasOwn(data, field)) payload[field] = data[field];
  const parsed = parseProcedureStepCreateInput(payload);
  return parsed ? { id: documentId, ...parsed } : null;
}

export function publicProcedure(procedure: PersistedProcedure) {
  return procedure;
}

export function publicProcedureStep(step: PersistedProcedureStep) {
  return step;
}
