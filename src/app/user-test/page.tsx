"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, getAuth } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import app, { db } from "@/lib/firebase";

const auth = getAuth(app);

export default function UserTestPage() {
  const [status, setStatus] = useState("جاري التحقق...");
  const [uid, setUid] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus("لا يوجد مستخدم مسجل الدخول");
        return;
      }

      setUid(user.uid);

      try {
        const q = query(
          collection(db, "platformUsers"),
          where("authUid", "==", user.uid)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          setStatus(
            "تم التعرف على المستخدم في Firebase Authentication، ولكن لا يوجد له سجل في platformUsers حتى الآن."
          );
        } else {
          setStatus("تم العثور على سجل platformUsers مرتبط بالمستخدم بنجاح.");
        }
      } catch (error) {
        console.error(error);
        setStatus("تم التعرف على المستخدم، لكن Firestore منع قراءة platformUsers.");
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <main
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-gray-50 px-4"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-2xl font-bold">اختبار مستخدم BusinessBrain</h1>

        <p className="mt-6 text-gray-700">{status}</p>

        {uid && (
          <div className="mt-6 rounded-lg bg-gray-100 p-4">
            <p className="text-sm text-gray-500">Firebase Auth UID</p>
            <p className="mt-1 break-all font-mono text-sm">{uid}</p>
          </div>
        )}
      </div>
    </main>
  );
}