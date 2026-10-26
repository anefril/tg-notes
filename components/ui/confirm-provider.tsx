"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface ConfirmOpts {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}
interface NotifyOpts {
  title: string;
  description?: string;
  okText?: string;
}

interface ConfirmCtx {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  notify: (opts: NotifyOpts) => Promise<void>;
}

const Ctx = createContext<ConfirmCtx | null>(null);

type DialogState =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "notify"; opts: NotifyOpts; resolve: () => void }
  | null;

// In-app replacement for window.confirm / window.alert — styled dialogs that
// match the rest of the UI instead of the browser's native popups.
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>(null);
  const stateRef = useRef<DialogState>(null);
  stateRef.current = state;

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setState({ kind: "confirm", opts, resolve });
      }),
    []
  );
  const notify = useCallback(
    (opts: NotifyOpts) =>
      new Promise<void>((resolve) => {
        setState({ kind: "notify", opts, resolve });
      }),
    []
  );

  const close = (result: boolean) => {
    const s = stateRef.current;
    setState(null);
    if (!s) return;
    if (s.kind === "confirm") s.resolve(result);
    else s.resolve();
  };

  const open = !!state;
  const isConfirm = state?.kind === "confirm";
  const opts = state?.opts;

  return (
    <Ctx.Provider value={{ confirm, notify }}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) close(false); }}>
        {opts && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{opts.title}</AlertDialogTitle>
              {opts.description && (
                <AlertDialogDescription>{opts.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              {isConfirm && (
                <AlertDialogCancel onClick={() => close(false)}>
                  {(opts as ConfirmOpts).cancelText || "Cancel"}
                </AlertDialogCancel>
              )}
              <AlertDialogAction
                onClick={() => close(true)}
                className={cn(
                  isConfirm && (opts as ConfirmOpts).destructive &&
                    "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                )}
              >
                {isConfirm
                  ? (opts as ConfirmOpts).confirmText || "Confirm"
                  : (opts as NotifyOpts).okText || "OK"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}
