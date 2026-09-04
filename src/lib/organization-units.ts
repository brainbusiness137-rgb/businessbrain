import {
  isValidFirestoreDocumentId,
  isValidRequiredString,
} from "@/lib/request-validation";
import {
  organizationUnitMembershipDocumentId,
  projectOrganizationUnitDocumentId,
} from "@/lib/tenant-model";

export type PersistedOrganizationUnit = {
  id: string;
  companyId: string;
  name: string;
  parentId: string | null;
  active: boolean;
};

export type PersistedOrganizationUnitMembership = {
  id: string;
  companyId: string;
  organizationUnitId: string;
  userId: string;
  active: boolean;
};

export type PersistedProjectOrganizationUnit = {
  id: string;
  companyId: string;
  projectId: string;
  organizationUnitId: string;
  active: boolean;
};

type TimestampLike = {
  toDate: () => Date;
};

function isTimestamp(value: unknown): value is TimestampLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as TimestampLike).toDate === "function"
  );
}

function isPlatformActorPath(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const [collection, documentId, extra] = value.split("/");
  return (
    collection === "platformUsers" &&
    extra === undefined &&
    isValidFirestoreDocumentId(documentId)
  );
}

export function parsePersistedOrganizationUnit(
  documentId: string,
  data: Record<string, unknown> | undefined
): PersistedOrganizationUnit | null {
  if (
    !isValidFirestoreDocumentId(documentId) ||
    !data ||
    typeof data.companyId !== "string" ||
    !isValidFirestoreDocumentId(data.companyId) ||
    !isValidRequiredString(data.name, 200) ||
    (data.parentId !== null &&
      (typeof data.parentId !== "string" ||
        !isValidFirestoreDocumentId(data.parentId))) ||
    typeof data.active !== "boolean" ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt) ||
    !isPlatformActorPath(data.createdBy)
  ) {
    return null;
  }

  return {
    id: documentId,
    companyId: data.companyId,
    name: data.name.trim(),
    parentId: data.parentId,
    active: data.active,
  };
}

export function parsePersistedOrganizationUnitMembership(
  documentId: string,
  data: Record<string, unknown> | undefined
): PersistedOrganizationUnitMembership | null {
  if (
    !data ||
    typeof data.companyId !== "string" ||
    !isValidFirestoreDocumentId(data.companyId) ||
    typeof data.organizationUnitId !== "string" ||
    !isValidFirestoreDocumentId(data.organizationUnitId) ||
    typeof data.userId !== "string" ||
    !isValidFirestoreDocumentId(data.userId) ||
    typeof data.active !== "boolean" ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt) ||
    !isPlatformActorPath(data.createdBy) ||
    organizationUnitMembershipDocumentId(
      data.organizationUnitId,
      data.userId
    ) !== documentId
  ) {
    return null;
  }

  return {
    id: documentId,
    companyId: data.companyId,
    organizationUnitId: data.organizationUnitId,
    userId: data.userId,
    active: data.active,
  };
}

export function parsePersistedProjectOrganizationUnit(
  documentId: string,
  data: Record<string, unknown> | undefined
): PersistedProjectOrganizationUnit | null {
  if (
    !data ||
    typeof data.companyId !== "string" ||
    !isValidFirestoreDocumentId(data.companyId) ||
    typeof data.projectId !== "string" ||
    !isValidFirestoreDocumentId(data.projectId) ||
    typeof data.organizationUnitId !== "string" ||
    !isValidFirestoreDocumentId(data.organizationUnitId) ||
    typeof data.active !== "boolean" ||
    !isTimestamp(data.createdAt) ||
    !isTimestamp(data.updatedAt) ||
    !isPlatformActorPath(data.createdBy) ||
    projectOrganizationUnitDocumentId(
      data.projectId,
      data.organizationUnitId
    ) !== documentId
  ) {
    return null;
  }

  return {
    id: documentId,
    companyId: data.companyId,
    projectId: data.projectId,
    organizationUnitId: data.organizationUnitId,
    active: data.active,
  };
}

export function filterValidOrganizationHierarchy(
  units: PersistedOrganizationUnit[],
  companyId: string
): PersistedOrganizationUnit[] {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const validity = new Map<string, boolean>();

  function hasValidAncestry(unit: PersistedOrganizationUnit): boolean {
    const known = validity.get(unit.id);
    if (known !== undefined) return known;

    const visited = new Set<string>();
    let current: PersistedOrganizationUnit | undefined = unit;

    while (current) {
      if (current.companyId !== companyId || visited.has(current.id)) {
        for (const id of visited) validity.set(id, false);
        return false;
      }

      const cached = validity.get(current.id);
      if (cached !== undefined) {
        for (const id of visited) validity.set(id, cached);
        return cached;
      }

      visited.add(current.id);

      if (current.parentId === null) {
        for (const id of visited) validity.set(id, true);
        return true;
      }

      current = unitsById.get(current.parentId);

      if (!current) {
        for (const id of visited) validity.set(id, false);
        return false;
      }
    }

    return false;
  }

  return units.filter(hasValidAncestry);
}
