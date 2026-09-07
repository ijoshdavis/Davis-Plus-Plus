"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { emailForPin } from "@/lib/pinAuth";
import { supabase } from "@/lib/supabase";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "⏎"];

export default function LoginPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(code: string) {
    if (!code || loading) return;
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: emailForPin(code),
      password: code,
    });
    setLoading(false);
    if (error) {
      setError("Incorrect code");
      setPin("");
      return;
    }
    router.replace("/");
  }

  function press(key: string) {
    if (loading) return;
    setError(null);
    if (key === "⌫") {
      setPin((p) => p.slice(0, -1));
    } else if (key === "⏎") {
      submit(pin);
    } else {
      setPin((p) => p + key);
    }
  }

  return (
    <main className="mx-auto mt-16 flex max-w-xs flex-col items-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Kinstore</h1>

      <div className="flex h-10 items-center gap-3">
        {pin.length === 0 ? (
          <span className="text-sm text-slate-400">Enter your code</span>
        ) : (
          Array.from({ length: pin.length }).map((_, i) => (
            <span key={i} className="h-3 w-3 rounded-full bg-slate-900" />
          ))
        )}
      </div>
      {error && <p className="-mt-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-3 gap-4">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            disabled={loading}
            className="flex h-16 w-16 items-center justify-center rounded-full border text-xl hover:bg-slate-50 disabled:opacity-50"
          >
            {key}
          </button>
        ))}
      </div>
    </main>
  );
}
