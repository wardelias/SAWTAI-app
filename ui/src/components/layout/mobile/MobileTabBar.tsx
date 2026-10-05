"use client";

import { Bot, Home, LayoutGrid, type LucideIcon, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { MobileAIHub } from "./MobileAIHub";

type Tab = {
    label: string;
    href: string;
    icon: LucideIcon;
    isActive: (pathname: string) => boolean;
};

const LEFT_TABS: Tab[] = [
    { label: "Home", href: "/overview", icon: Home, isActive: (p) => p.startsWith("/overview") },
    { label: "Agents", href: "/workflow", icon: Bot, isActive: (p) => p.startsWith("/workflow") },
];

const RIGHT_TABS: Tab[] = [
    { label: "Leads", href: "/leads", icon: Users, isActive: (p) => p.startsWith("/leads") },
];

function TabLink({ tab, pathname }: { tab: Tab; pathname: string }) {
    const active = tab.isActive(pathname);
    const Icon = tab.icon;
    return (
        <Link
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
                "flex flex-col items-center gap-0.5 text-[11px] font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground",
            )}
        >
            <span
                className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-foreground/10",
                )}
            >
                <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={active ? 2.25 : 1.75} />
            </span>
            {tab.label}
        </Link>
    );
}

/**
 * Phone-only bottom navigation. The raised centre button opens the AI hub;
 * "More" opens the full sidebar as a sheet.
 */
export function MobileTabBar() {
    const pathname = usePathname();
    const { setOpenMobile, openMobile } = useSidebar();
    const [aiOpen, setAiOpen] = useState(false);

    // Lets global CSS lift floating widgets (support chat) above the bar.
    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute("data-mobile-tabbar", "");
        return () => root.removeAttribute("data-mobile-tabbar");
    }, []);

    return (
        <>
            <nav
                aria-label="Primary"
                className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/85 md:hidden"
            >
                <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-center px-1">
                    {LEFT_TABS.map((tab) => (
                        <TabLink key={tab.href} tab={tab} pathname={pathname} />
                    ))}

                    <div className="flex justify-center">
                        <button
                            type="button"
                            onClick={() => setAiOpen(true)}
                            aria-label="Open AI assistant"
                            aria-haspopup="dialog"
                            className="flex flex-col items-center gap-0.5 text-[11px] font-semibold text-ai"
                        >
                            <span className="ai-halo -mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-ai text-ai-foreground shadow-lg shadow-ai/30 ring-4 ring-background transition-transform active:scale-95">
                                <Sparkles className="h-6 w-6" />
                            </span>
                            AI
                        </button>
                    </div>

                    {RIGHT_TABS.map((tab) => (
                        <TabLink key={tab.href} tab={tab} pathname={pathname} />
                    ))}

                    <button
                        type="button"
                        onClick={() => setOpenMobile(true)}
                        aria-label="More navigation"
                        aria-expanded={openMobile}
                        className={cn(
                            "flex flex-col items-center gap-0.5 text-[11px] font-medium",
                            openMobile ? "text-foreground" : "text-muted-foreground",
                        )}
                    >
                        <span className="flex h-7 w-12 items-center justify-center rounded-full">
                            <LayoutGrid className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.75} />
                        </span>
                        More
                    </button>
                </div>
            </nav>
            <MobileAIHub open={aiOpen} onOpenChange={setAiOpen} />
        </>
    );
}
