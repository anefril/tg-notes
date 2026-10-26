"use client";

import { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Send,
  Loader2,
  Shield,
  MessageSquare,
  ArrowRight,
  CheckCircle2,
  Bot,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type Step = "start" | "sent" | "enter-code" | "success";

export function LoginScreen() {
  const [step, setStep] = useState<Step>("start");
  const [code, setCode] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [botConfigured, setBotConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [pulse, setPulse] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  // Load bot username from server on mount
  useEffect(() => {
    setMounted(true);
    fetch("/api/bot/register")
      .then((r) => r.json())
      .then((data) => {
        if (data.configured && data.botUsername) {
          setBotUsername(data.botUsername);
          setBotConfigured(true);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (step === "enter-code" && codeRef.current) {
      codeRef.current.focus();
    }
  }, [step]);

  useEffect(() => {
    if (step === "sent") {
      const interval = setInterval(() => setPulse((p) => !p), 1500);
      return () => clearInterval(interval);
    }
  }, [step]);

  const handleOpenBot = () => {
    if (!botConfigured) {
      setError("Set up the bot first");
      return;
    }
    setError("");
    setStep("sent");
    window.open(`https://t.me/${botUsername}`, "_blank");
    setTimeout(() => setStep("enter-code"), 2000);
  };

  const handleVerify = async () => {
    if (code.length !== 8) {
      setError("Enter the 8-digit code");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Verification error");
        return;
      }

      const { user: dbUser, accessToken, refreshToken } = await res.json();

      const { supabase } = await import("@/lib/supabase");
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) {
        setError("Session error");
        return;
      }

      localStorage.setItem("tg_notes_user", JSON.stringify(dbUser));
      localStorage.setItem("tg_notes_access_token", accessToken);
      localStorage.setItem("tg_notes_refresh_token", refreshToken);

      setStep("success");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in error");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    setCode(digits);
    setError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div
        className={`w-full max-w-md space-y-8 transition-all duration-700 ${
          mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        }`}
      >
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary shadow-lg shadow-primary/25">
            <BookOpen className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Telegram Notes</h1>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto leading-relaxed">
            Sign in with the Telegram bot to get to your notes
          </p>
        </div>

        <Card className="border-border/50 shadow-xl shadow-black/5">
          <CardContent className="pt-6 pb-6 space-y-6">
            {/* Step indicators */}
            <div className="flex items-center justify-center gap-3">
              {[
                { label: "1", active: step !== "start" },
                { label: "2", active: step === "enter-code" || step === "success" },
                { label: "3", active: step === "success" },
              ].map((s, i) => (
                <div key={s.label} className="flex items-center gap-3">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all duration-500 ${
                      s.active
                        ? "bg-primary text-primary-foreground scale-110"
                        : "bg-muted text-muted-foreground"
                    } ${step === "success" && i === 2 ? "bg-green-500 text-white" : ""}`}
                  >
                    {step === "success" && i === 2 ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      s.label
                    )}
                  </div>
                  {i < 2 && (
                    <div
                      className={`w-8 h-0.5 rounded transition-colors duration-500 ${
                        s.active ? "bg-primary" : "bg-muted"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Step 1: Bot configured - open Telegram */}
            {step === "start" && (
              <div className="space-y-4">
                {botConfigured ? (
                  <>
                    <div className="text-center space-y-1">
                      <h2 className="text-lg font-semibold">Sign in with Telegram</h2>
                      <p className="text-xs text-muted-foreground">
                        Open the bot <span className="font-medium text-foreground">@{botUsername}</span> and send /start
                      </p>
                    </div>

                    <Button
                      className="w-full h-12 text-sm font-medium gap-2"
                      onClick={handleOpenBot}
                    >
                      <Bot className="h-5 w-5" />
                      Open the bot in Telegram
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="text-center space-y-1">
                      <h2 className="text-lg font-semibold">The bot isn't set up</h2>
                      <p className="text-xs text-muted-foreground">
                        Connect a Telegram bot first so users can sign in
                      </p>
                    </div>

                    <div className="flex items-center gap-2 bg-destructive/10 text-destructive rounded-lg p-3 text-xs">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>Set up the bot on the setup page</span>
                    </div>

                    <Button
                      className="w-full h-11 text-sm font-medium"
                      onClick={() => (window.location.href = "/setup")}
                    >
                      <Bot className="h-4 w-4 mr-2" />
                      Set up the bot
                    </Button>
                  </>
                )}

                {error && (
                  <p className="text-xs text-destructive text-center">{error}</p>
                )}

                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    How it works:
                  </p>
                  <ol className="text-[11px] text-muted-foreground/80 space-y-1 list-decimal list-inside">
                    <li>Tap the button above to open the bot</li>
                    <li>Send <code className="bg-background px-1 rounded">/start</code> to the bot</li>
                    <li>Get an 8-digit code in Telegram</li>
                    <li>Enter the code on the next screen</li>
                  </ol>
                </div>
              </div>
            )}

            {/* Step 2: Sent to bot, waiting */}
            {step === "sent" && (
              <div className="space-y-4 text-center">
                <div
                  className={`mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center transition-all duration-700 ${
                    pulse ? "scale-110 bg-primary/20" : "scale-100"
                  }`}
                >
                  <MessageSquare className="h-8 w-8 text-primary" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Send /start to the bot</h2>
                  <p className="text-xs text-muted-foreground">
                    @{botUsername} will send you a sign-in code
                  </p>
                </div>
                <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
              </div>
            )}

            {/* Step 3: Enter code */}
            {step === "enter-code" && (
              <div className="space-y-4">
                <div className="text-center space-y-1">
                  <h2 className="text-lg font-semibold">Enter the code</h2>
                  <p className="text-xs text-muted-foreground">
                    @{botUsername} sent you an 8-digit code
                  </p>
                </div>

                <div className="flex justify-center gap-2">
                  <Input
                    ref={codeRef}
                    value={code}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    placeholder="00000000"
                    className="text-center text-2xl font-mono tracking-[0.4em] h-14 w-64"
                    maxLength={8}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                  />
                </div>

                <div className="flex justify-center gap-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full transition-colors ${
                        i < code.length ? "bg-primary" : "bg-muted"
                      }`}
                    />
                  ))}
                </div>

                {error && (
                  <p className="text-xs text-destructive text-center">{error}</p>
                )}

                <Button
                  className="w-full h-11 text-sm font-medium"
                  onClick={handleVerify}
                  disabled={code.length !== 8 || loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ArrowRight className="h-4 w-4 mr-2" />
                  )}
                  Sign in
                </Button>

                <button
                  onClick={() => {
                    setStep("start");
                    setCode("");
                    setError("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
                >
                  Back
                </button>
              </div>
            )}

            {/* Step 4: Success */}
            {step === "success" && (
              <div className="space-y-4 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
                <h2 className="text-lg font-semibold">Signed in!</h2>
                <p className="text-xs text-muted-foreground">Redirecting...</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Features */}
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { icon: Shield, label: "Secure", desc: "Code from Telegram" },
            { icon: MessageSquare, label: "Fast", desc: "Takes 30 seconds" },
            { icon: BookOpen, label: "Smart tags", desc: "Tags and topics" },
          ].map((f) => (
            <div key={f.label} className="space-y-1">
              <f.icon className="h-4 w-4 text-muted-foreground mx-auto" />
              <p className="text-xs font-medium">{f.label}</p>
              <p className="text-[10px] text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <a
            href="/setup"
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-4 hover:underline"
          >
            Set up the Telegram bot
          </a>
        </div>
      </div>
    </div>
  );
}
