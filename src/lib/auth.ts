import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  authUid: string;
  role: string;
  permissions: Record<string, boolean>;
  active: boolean;
};

export async function getCurrentPlatformUser(): Promise<PlatformUser | null> {
  try {
    const cookieStore = await cookies();

    const sessionCookie = cookieStore.get(
      "businessbrain_session"
    )?.value;

    if (!sessionCookie) {
      return null;
    }

    const decodedClaims =
      await adminAuth.verifySessionCookie(sessionCookie, true);

    const snapshot = await adminDb
      .collection("platformUsers")
      .where("authUid", "==", decodedClaims.uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    if (data.active !== true) {
      return null;
    }

    return {
      id: doc.id,
      name: data.name,
      email: data.email,
      authUid: data.authUid,
      role: data.role,
      permissions: data.permissions ?? {},
      active: data.active,
    };
  } catch (error) {
    console.error("getCurrentPlatformUser failed:", error);
    return null;
  }
}
export function hasPermission(
  user: PlatformUser,
  permission: string
): boolean {
  return user.permissions?.[permission] === true;
}