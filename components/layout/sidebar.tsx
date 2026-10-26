"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Trash2, Menu, LogOut, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/auth-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TopSearch } from "@/components/search/top-search";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/trash", label: "Trash", icon: Trash2 },
];

const PIN_KEY = "tg_notes_sidebar_pinned";

// Google-Keep-style vertical rail: a thin stationary strip with the ☰ pin
// toggle, an embedded search, nav icons (centred), and the account avatar at the
// bottom. Expands (on hover, pin, or while searching) to show labels + a search
// field. The theme switch is a separate button pinned top-right.
export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();

  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);

  const expanded = pinned || hovered;

  useEffect(() => {
    setPinned(localStorage.getItem(PIN_KEY) === "1");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("sidebar-pinned", pinned);
  }, [pinned]);

  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      localStorage.setItem(PIN_KEY, next ? "1" : "0");
      return next;
    });
  };

  const initials =
    user?.name?.split(" ").map((w) => w[0]).join("").slice(0, 2) || "U";

  // Collapsed: the label must take ZERO width (not just opacity-0), otherwise it
  // keeps its natural width and justify-center pushes the icon off to the left.
  const labelCls = cn(
    "overflow-hidden whitespace-nowrap text-lg font-semibold transition-all duration-200",
    expanded ? "w-auto opacity-100" : "pointer-events-none w-0 opacity-0"
  );

  return (
    <>
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "z-40 hidden border-r border-border/60 backdrop-blur-xl transition-[width] duration-200 ease-out md:fixed md:inset-y-0 md:flex md:flex-col",
          expanded
            ? "md:w-64 supports-[backdrop-filter]:bg-background/80"
            : "md:w-20 supports-[backdrop-filter]:bg-background/40",
          hovered && !pinned && "md:shadow-xl"
        )}
      >
        {/* ☰ pin toggle */}
        <div className={cn("flex h-16 items-center", expanded ? "px-3" : "justify-center px-0")}>
          <button
            onClick={togglePin}
            title={pinned ? "Collapse the panel" : "Keep the panel open"}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Menu className="h-7 w-7" />
          </button>
        </div>

        {/* Nav (icons centred when collapsed) */}
        <nav
          className={cn(
            "scrollbar-thin flex flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden py-2",
            expanded ? "px-3" : "items-center px-0"
          )}
        >
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  "flex h-14 items-center rounded-full transition-colors",
                  expanded ? "w-full gap-4 px-4" : "w-14 justify-center",
                  isActive
                    ? "bg-primary/15 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <item.icon className="h-7 w-7 shrink-0" />
                <span className={labelCls}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Account at the bottom */}
        <div className={cn("py-3", expanded ? "px-3" : "flex justify-center px-0")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title={user?.name || "Account"}
                className={cn(
                  "flex h-14 items-center rounded-full transition-colors hover:bg-accent",
                  expanded ? "w-full gap-3 px-3" : "w-14 justify-center"
                )}
              >
                <Avatar className="h-11 w-11 shrink-0">
                  <AvatarImage src={user?.avatar} />
                  <AvatarFallback className="text-base">{initials}</AvatarFallback>
                </Avatar>
                {expanded && <span className="min-w-0 flex-1 truncate text-left text-base font-semibold">{user?.name || "Account"}</span>}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              {user?.name && <DropdownMenuLabel className="truncate">{user.name}</DropdownMenuLabel>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Standalone theme toggle, top-right */}
      <button
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        title="Switch theme"
        className="fixed right-4 top-3 z-50 hidden h-10 w-10 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent md:flex"
      >
        <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </button>

      {/* Centred top search bar (Google-Keep style) */}
      <TopSearch />
    </>
  );
}
