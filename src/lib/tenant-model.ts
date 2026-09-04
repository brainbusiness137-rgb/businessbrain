import { createHash } from "node:crypto";

export function companyUserDocumentId(authUid: string): string {
  return createHash("sha256")
    .update(`company-user:${authUid}`)
    .digest("hex");
}

export function projectMembershipDocumentId(
  projectId: string,
  userId: string
): string | null {
  return orderedPairDocumentId("p", projectId, "u", userId);
}

export function organizationUnitMembershipDocumentId(
  organizationUnitId: string,
  userId: string
): string | null {
  return orderedPairDocumentId(
    "o",
    organizationUnitId,
    "u",
    userId
  );
}

export function projectOrganizationUnitDocumentId(
  projectId: string,
  organizationUnitId: string
): string | null {
  return orderedPairDocumentId(
    "p",
    projectId,
    "o",
    organizationUnitId
  );
}

function orderedPairDocumentId(
  firstLabel: string,
  firstValue: string,
  secondLabel: string,
  secondValue: string
): string | null {
  const encodedFirstValue = Buffer.from(firstValue, "utf8").toString(
    "base64url"
  );
  const encodedSecondValue = Buffer.from(secondValue, "utf8").toString(
    "base64url"
  );
  const documentId = `${firstLabel}.${encodedFirstValue}.${secondLabel}.${encodedSecondValue}`;

  if (
    encodedFirstValue.length === 0 ||
    encodedSecondValue.length === 0 ||
    Buffer.byteLength(documentId, "utf8") > 1500
  ) {
    return null;
  }

  return documentId;
}

export function platformActorPath(platformUserId: string): string {
  return `platformUsers/${platformUserId}`;
}

export function companyUserActorPath(companyUserId: string): string {
  return `users/${companyUserId}`;
}
