"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignup = mode === "signup";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);
    const supabase = getSupabaseClient();
    const result = isSignup
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setIsSubmitting(false);
    if (result.error) return setError(result.error.message);
    if (isSignup && !result.data.session) return setMessage("Check your email to confirm your account, then log in.");
    router.replace("/");
  }

  return <main className="auth-page"><section className="auth-card"><Link className="auth-brand" href="/"><span className="brand-mark">E</span><span>Explore</span></Link><p className="eyebrow">{isSignup ? "CREATE YOUR JOURNAL" : "WELCOME BACK"}</p><h1>{isSignup ? "Start remembering." : "Open your journal."}</h1><p className="auth-intro">{isSignup ? "Create a private account for your places, people, and memories." : "Sign in to continue to your personal place journal."}</p><form onSubmit={submit}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /><label htmlFor="password">Password</label><input id="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required />{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}<button type="submit" disabled={isSubmitting}>{isSubmitting ? "Please wait…" : isSignup ? "Create account" : "Log in"}</button></form><p className="auth-switch">{isSignup ? "Already have an account?" : "New to Explore?"} <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Create an account"}</Link></p></section></main>;
}
