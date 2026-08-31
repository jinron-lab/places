"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  isAuthLoaded: boolean;
  initials: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const publicRoutes = new Set(["/login", "/signup"]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseClient();
    let active = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        console.error("[initial-auth] Session restoration failed.", {
          code: error.code,
          message: error.message,
        });
      }
      const restoredSession = error ? null : data.session;
      console.info("[initial-auth] Authentication initialized.", {
        isAuthLoaded: true,
        hasSession: Boolean(restoredSession),
        hasUser: Boolean(restoredSession?.user),
        userId: restoredSession?.user.id ?? null,
      });
      setSession(restoredSession);
      setUser(restoredSession?.user ?? null);
      setIsAuthLoaded(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!user && !publicRoutes.has(pathname)) router.replace("/login");
    if (user && publicRoutes.has(pathname)) router.replace("/");
  }, [isAuthLoaded, pathname, router, user]);

  const value = useMemo<AuthContextValue>(() => {
    const emailName = user?.email?.split("@")[0] ?? "";
    const initials = emailName.split(/[._\-\s]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "ME";
    return {
      user,
      session,
      isAuthLoaded,
      initials,
      signOut: async () => {
        const { error } = await getSupabaseClient().auth.signOut();
        if (error) throw error;
        router.replace("/login");
      },
    };
  }, [isAuthLoaded, router, session, user]);

  const canRender = publicRoutes.has(pathname) || (isAuthLoaded && Boolean(user));
  return <AuthContext.Provider value={value}>{canRender ? children : <div className="auth-loading">Opening Explore…</div>}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
