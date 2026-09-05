"use client";

import { getAuth, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import app from "@/lib/firebase";

const auth = getAuth(app);

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "X-BusinessBrain-Origin": window.location.origin },
      });

      if (!response.ok) {
        throw new Error("Server logout failed");
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      try {
        await signOut(auth);
      } catch (error) {
        console.error("Firebase client logout error:", error);
      }

      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
    >
      تسجيل الخروج
    </button>
  );
}
