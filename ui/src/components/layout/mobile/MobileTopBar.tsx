"use client";

import { ChevronLeft, CreditCard, LogOut, Moon, Settings, Sun, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SawtLogo } from "@/components/SawtLogo";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type LocalUser, useAuth } from "@/lib/auth";

import { getMobileSectionTitle, isNestedPath } from "./mobileNav";

function useThemeToggle() {
    const [isDark, setIsDark] = useState(true);
    useEffect(() => {
        setIsDark(document.documentElement.classList.contains("dark"));
    }, []);
    const toggle = () => {
        const next = !isDark;
        setIsDark(next);
        try {
            localStorage.setItem("theme", next ? "dark" : "light");
        } catch {
            // Storage can be unavailable (private mode); the class still flips.
        }
        document.documentElement.classList.toggle("dark", next);
    };
    return { isDark, toggle };
}

function AccountMenu() {
    const router = useRouter();
    const { provider, user, logout } = useAuth();
    const { isDark, toggle } = useThemeToggle();

    const email =
        (user as LocalUser | undefined)?.email ||
        (user as { primaryEmail?: string } | undefined)?.primaryEmail ||
        "";
    const displayName = user?.displayName || (user as LocalUser | undefined)?.name || "";
    const initials =
        (displayName || email || "U")
            .split(/[\s@]/)
            .filter(Boolean)
            .slice(0, 2)
            .map((s: string) => s[0]?.toUpperCase())
            .join("") || "U";

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    aria-label="Account menu"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-muted/60 text-xs font-semibold"
                >
                    {initials}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                        {displayName && <p className="text-sm font-medium">{displayName}</p>}
                        {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {provider === "stack" && (
                    <DropdownMenuItem className="h-10" onClick={() => router.push("/handler/account-settings")}>
                        <User className="mr-2 h-4 w-4" />
                        Account settings
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem className="h-10" onClick={() => router.push("/settings")}>
                    <Settings className="mr-2 h-4 w-4" />
                    Platform settings
                </DropdownMenuItem>
                <DropdownMenuItem className="h-10" onClick={() => router.push("/billing")}>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Usage & billing
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="h-10"
                    onSelect={(event) => {
                        event.preventDefault();
                        toggle();
                    }}
                >
                    {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                    {isDark ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    className="h-10 text-destructive focus:text-destructive"
                    onClick={() => logout()}
                >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** Phone-only app bar: logo (or back + section title on nested pages) and account. */
export function MobileTopBar() {
    const pathname = usePathname();
    const router = useRouter();
    const nested = isNestedPath(pathname);

    const handleBack = () => {
        if (window.history.length > 1) {
            router.back();
        } else {
            router.push(`/${pathname.split("/").filter(Boolean)[0] ?? "overview"}`);
        }
    };

    return (
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/65 md:hidden">
            <div className="flex h-14 items-center gap-1 px-3">
                {nested ? (
                    <>
                        <button
                            type="button"
                            onClick={handleBack}
                            aria-label="Back"
                            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full active:bg-accent"
                        >
                            <ChevronLeft className="h-6 w-6" />
                        </button>
                        <span className="truncate text-base font-semibold">
                            {getMobileSectionTitle(pathname)}
                        </span>
                    </>
                ) : (
                    <Link href="/overview" aria-label="SawtAI home" className="flex items-center pl-1">
                        <SawtLogo className="h-8 w-auto" />
                    </Link>
                )}
                <div className="ml-auto flex items-center gap-2">
                    <AccountMenu />
                </div>
            </div>
        </header>
    );
}
