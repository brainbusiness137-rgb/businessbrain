"use client";

import { useEffect, useState } from "react";
import { getDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function FirebaseTestPage() {
  const [status, setStatus] = useState("جاري اختبار الاتصال...");

  useEffect(() => {
    async function testConnection() {
      try {
        await getDoc(doc(db, "platformUsers", "connection-test"));

        setStatus("تم الاتصال بـ Firebase و Firestore بنجاح");
      } catch (error) {
        console.error(error);
        setStatus("فشل الاتصال بـ Firebase / Firestore");
      }
    }

    testConnection();
  }, []);

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">
          اختبار اتصال BusinessBrain
        </h1>

        <p className="mt-4">
          {status}
        </p>
      </div>
    </main>
  );
}