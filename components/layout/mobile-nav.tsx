"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Search, Menu, BookOpen, LogOut, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { ThemeToggle } from "./theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";

const navItems = [
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/search", label: "Search", icon: Search },
  { href: "/trash", label: "Trash", icon: Trash2 },
];

export function MobileNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const initials = user?.name
    ?.split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2) || "U";

  return (
    <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between h-14 px-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary">
          <BookOpen className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
        <span className="font-semibold text-base">TG Notes</span>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex items-center justify-between h-14 px-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary">
                  <BookOpen className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
                <span className="font-semibold">TG Notes</span>
              </div>
            </div>
            <nav className="px-3 py-4 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="absolute bottom-0 left-0 right-0 px-3 pb-4 pt-3 border-t border-border">
              <div className="flex items-center gap-3 px-3 py-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user?.avatar} />
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.name || "User"}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={logout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
