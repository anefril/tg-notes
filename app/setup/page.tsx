"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Settings, Webhook, CheckCircle2, Loader2, Copy, Bot, AlertCircle } from "lucide-react";

type SetupStep = 1 | 2 | 3;

export default function SetupPage() {
  const [botToken, setBotToken] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [step, setStep] = useState<SetupStep>(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState("");
  const [botInfo, setBotInfo] = useState<{ username: string; configured: boolean } | null>(null);

  useEffect(() => {
    // Check if bot is already configured
    fetch("/api/bot/register")
      .then((r) => r.json())
      .then((data) => {
        if (data.configured) {
          setBotUsername(data.botUsername);
          setBotInfo({ username: data.botUsername, configured: true });
        }
      })
      .catch(() => {});
  }, []);

  const registerBot = async () => {
    if (!botToken.trim()) return;
    setLoading(true);
    setResult("");
    try {
      const res = await fetch("/api/bot/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken: botToken.trim(),
          botUsername: botUsername.trim(),
          adminKey: adminKey.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setResult(data.error || "Registration error");
        return;
      }

      setBotUsername(data.botUsername);
      setBotInfo({ username: data.botUsername, configured: true });
      setResult("Bot registered! Webhook is set.");
      setStep(3);
    } catch (err) {
      setResult("Couldn't reach the server — error");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary">
            <Bot className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Telegram bot setup</h1>
          <p className="text-sm text-muted-foreground">
            Connect a bot to enable sign-in with Telegram
          </p>
        </div>

        {botInfo?.configured && step !== 3 && (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div className="text-sm">
                <span className="font-medium">Bot @{botInfo.username} is already connected.</span>
                <span className="text-muted-foreground ml-1">Enter a new token to replace it.</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 1 */}
        <Card className={step < 1 ? "opacity-50 pointer-events-none" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step > 1 ? "bg-green-500 text-white" : "bg-primary text-primary-foreground"
                }`}
              >
                {step > 1 ? <CheckCircle2 className="h-3 w-3" /> : "1"}
              </div>
              Create a bot with @BotFather
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
              <li>
                Open{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  @BotFather
                </a>{" "}
                in Telegram
              </li>
              <li>
                Send <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">/newbot</code>
              </li>
              <li>Pick a name and a username for the bot</li>
              <li>Paste the token you get below</li>
            </ol>
            {step === 1 && (
              <div className="pt-2 space-y-2">
                <Input
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  value={botToken}
                  onChange={(e) => {
                    setBotToken(e.target.value);
                    setResult("");
                  }}
                />
                <Button
                  className="w-full"
                  disabled={!botToken.trim()}
                  onClick={() => setStep(2)}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2 */}
        <Card className={step < 2 ? "opacity-50 pointer-events-none" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step > 2
                    ? "bg-green-500 text-white"
                    : step < 2
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {step > 2 ? <CheckCircle2 className="h-3 w-3" /> : "2"}
              </div>
              Connect the bot
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Click the button below — the server checks the token, registers the webhook and saves the settings.
              Everything happens on the server, no CORS issues.
            </p>

            <Input
              type="password"
              placeholder="Admin key (ADMIN_SECRET)"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Protects against bot hijacking: enter the secret admin key set in the server environment.
            </p>

            <Button
              className="w-full"
              onClick={registerBot}
              disabled={loading || !botToken.trim() || !adminKey.trim()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Webhook className="h-4 w-4 mr-2" />
              )}
              Register the bot and webhook
            </Button>

            {result && (
              <div
                className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
                  /error|invalid|forbidden|failed|required/i.test(result)
                    ? "bg-destructive/10 text-destructive"
                    : "bg-green-500/10 text-green-700 dark:text-green-400"
                }`}
              >
                {/error|invalid|forbidden|failed|required/i.test(result) ? (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                )}
                {result}
              </div>
            )}

            {step === 2 && !loading && (
              <button
                onClick={() => {
                  setStep(1);
                  setResult("");
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
              >
                Back
              </button>
            )}
          </CardContent>
        </Card>

        {/* Step 3 */}
        <Card className={step < 3 ? "opacity-50 pointer-events-none" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step >= 3 ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {step >= 3 ? <CheckCircle2 className="h-3 w-3" /> : "3"}
              </div>
              Done!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Bot <span className="font-medium text-foreground">@{botUsername}</span> is connected and ready.
            </p>

            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">How it works:</p>
              <ol className="text-[11px] text-muted-foreground/80 space-y-1 list-decimal list-inside">
                <li>The user opens the website and taps "Open the bot in Telegram"</li>
                <li>
                  Sends <code className="bg-background px-1 rounded">/start</code> to the bot
                </li>
                <li>The bot sends an 8-digit code (valid for 5 minutes)</li>
                <li>The user enters the code on the website and is signed in</li>
              </ol>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => {
                  setStep(1);
                  setBotToken("");
                  setResult("");
                }}
              >
                Replace the bot
              </Button>
              <Button className="flex-1" onClick={() => (window.location.href = "/")}>
                Go to the home page
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
