"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignup = mode === "sign-up";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [working, setWorking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setErrorCode("");

    if (isSignup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setWorking(true);
    try {
      if (isSignup) {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const body = await response.json();

        if (!response.ok) {
          setErrorCode(body.code || "");
          throw new Error(body.message || "Could not create your account.");
        }
      }

      const credentialCheck = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const credentialBody = await credentialCheck.json();
      if (!credentialCheck.ok) throw new Error(credentialBody.message || "Could not sign in.");

      const result = await signIn("credentials", {
        email,
        password,
        callbackUrl: "/",
        redirect: false
      });

      // Do not navigate with the App Router here.  A client-side transition can
      // request the dashboard before the browser has committed Auth.js's new
      // session cookie, which sends a valid sign-in straight back to /sign-in.
      if (!result || result.error || result.ok === false) {
        throw new Error("Sign-in could not be completed. Please try again.");
      }

      window.location.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <Link href="/" className="auth-brand"><span>K</span> ListingKing</Link>
        <div className="intro-copy">
          <p className="eyebrow">MEESHO SELLER WORKFLOW</p>
          <h1>Prepare catalog items with calm, precise control.</h1>
          <p>Build reusable form templates, prepare listings in batches, then review every field before it reaches Meesho.</p>
        </div>
        <ul><li>Meesho-only form templates</li><li>Seller-controlled product pricing</li><li>No automatic catalog submission</li></ul>
        <small>ListingKing is independent from Meesho. Always review final marketplace data.</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">{isSignup ? "CREATE YOUR WORKSPACE" : "WELCOME BACK"}</p>
          <h2>{isSignup ? "Create your ListingKing account" : "Sign in to ListingKing"}</h2>
          <p className="auth-subtitle">{isSignup ? "Start with your first reusable Meesho template." : "Continue preparing your Meesho catalog items."}</p>
          <form onSubmit={submit}>
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
            <label>Password<input type="password" autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /></label>
            {isSignup && <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Enter your password again" minLength={8} required /></label>}
            {error && <p className="auth-error" role="alert">{error} {isSignup && errorCode === "EMAIL_TAKEN" && <Link href="/sign-in">Sign in</Link>}</p>}
            <button className="auth-submit" disabled={working}>{working ? "Please wait…" : isSignup ? "Create account" : "Sign in"} <span>→</span></button>
          </form>
          <p className="auth-switch">{isSignup ? "Already have an account?" : "New to ListingKing?"} <Link href={isSignup ? "/sign-in" : "/sign-up"}>{isSignup ? "Sign in" : "Create an account"}</Link></p>
        </div>
      </section>
    </main>
  );
}
