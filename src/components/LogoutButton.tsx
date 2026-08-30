"use client";

import { getAuth, signOut } from "firebase/auth";
import app from "@/lib/firebase";

const auth = getAuth(app);

export default function LogoutButton() {
  async function handleLogout() {
    try {
      await signOut(auth);
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout error:", error);
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