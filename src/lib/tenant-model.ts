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
  const encodedProjectId = Buffer.from(projectId, "utf8").toString(
    "base64url"
  );
  const encodedUserId = Buffer.from(userId, "utf8").toString(
    "base64url"
  );
  const documentId = `p.${encodedProjectId}.u.${encodedUserId}`;

  if (
    encodedProjectId.length === 0 ||
    encodedUserId.length === 0 ||
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
