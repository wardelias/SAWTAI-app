"use client";

import type { Team } from "@stackframe/stack";
import {
  AlertTriangle,
  ArrowUpCircle,
  AudioLines,
  Brain,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CreditCard,
  Database,
  FileText,
  HelpCircle,
  Home,
  Key,
  LogOut,
  type LucideIcon,
  Megaphone,
  Phone,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  User,
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";

import { getMpsCreditsApiV1OrganizationsUsageMpsCreditsGet } from "@/client/sdk.gen";
import type { MpsCreditsResponse } from "@/client/types.gen";
import { SawtLogo } from "@/components/SawtLogo";
import ThemeToggle from "@/components/ThemeSwitcher";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppConfig } from "@/context/AppConfigContext";
import { useTelephonyConfigWarnings } from "@/context/TelephonyConfigWarningsContext";
import { useUserConfig } from "@/context/UserConfigContext";
import { useLatestReleaseVersion } from "@/hooks/useLatestReleaseVersion";
import { useAuth, type LocalUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

type SidebarNavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  showsTelephonyWarning?: boolean;
};

type SidebarNavSection = {
  label?: string;
  items: SidebarNavItem[];
};

const TELEPHONY_WARNING_COPY = "Action required";

const NAV_SECTIONS: SidebarNavSection[] = [
  {
    items: [
      {
        title: "Overview",
        url: "/overview",
        icon: Home,
      },
      {
        title: "Calendar",
        url: "/calendar",
        icon: CalendarDays,
      },
      {
        title: "Campaigns",
        url: "/campaigns",
        icon: Megaphone,
      },
      {
        title: "Marketing",
        url: "/marketing",
        icon: Target,
      },
    ],
  },
  {
    label: "BUILD",
    items: [
      {
        title: "Voice Agents",
        url: "/workflow",
        icon: Workflow,
      },
      {
        title: "Models",
        url: "/model-configurations",
        icon: Brain,
      },
      {
        title: "Telephony",
        url: "/telephony-configurations",
        icon: Phone,
        showsTelephonyWarning: true,
      },
      {
        title: "Tools",
        url: "/tools",
        icon: Wrench,
      },
      {
        title: "Files",
        url: "/files",
        icon: Database,
      },
      {
        title: "Recordings",
        url: "/recordings",
        icon: AudioLines,
      },
      {
        title: "Developers",
        url: "/api-keys",
        icon: Key,
      },
    ],
  },
  {
    label: "OBSERVE",
    items: [
      {
        title: "Agent Runs",
        url: "/usage",
        icon: TrendingUp,
      },
      {
        title: "Reports",
        url: "/reports",
        icon: FileText,
      },
    ],
  },
];

// Lazy load SelectedTeamSwitcher - we'll pass selectedTeam from our context
const StackTeamSwitcher = React.lazy(() =>
  import("@stackframe/stack").then((mod) => ({
    default: mod.SelectedTeamSwitcher,
  }))
);

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { provider, getSelectedTeam, user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const { config } = useAppConfig();
  const { organizationPricing } = useUserConfig();
  const { telnyxMissingWebhookPublicKeyCount } = useTelephonyConfigWarnings();
  const hasTelephonyWarning = telnyxMissingWebhookPublicKeyCount > 0;
  const isCollapsed = !isMobile && state === "collapsed";

  const [credits, setCredits] = useState<MpsCreditsResponse | null>(null);
  const hasFetchedCredits = useRef(false);
  useEffect(() => {
    if (authLoading || !isAuthenticated || hasFetchedCredits.current) return;
    hasFetchedCredits.current = true;
    getMpsCreditsApiV1OrganizationsUsageMpsCreditsGet()
      .then((res) => {
        if (res.data) setCredits(res.data);
      })
      .catch(() => {
        // silent — footer just hides the trial card if credits aren't available
      });
  }, [authLoading, isAuthenticated]);

  const billingEnabled = organizationPricing?.billing_enabled ?? false;
  const accountStatus: "active" | "trial" = billingEnabled ? "active" : "trial";
  const creditsRemaining = credits ? Math.max(0, credits.remaining_credits) : null;
  const creditsTotal = credits?.total_quota ?? 0;
  const creditsUsed = credits?.total_credits_used ?? 0;
  const creditsPct = creditsTotal > 0 ? Math.min(100, (creditsUsed / creditsTotal) * 100) : 0;

  const email =
    (user as LocalUser | undefined)?.email ||
    (user as { primaryEmail?: string } | undefined)?.primaryEmail ||
    "";
  const displayName = user?.displayName || email || "Account";
  const initials =
    (user?.displayName || email || "U")
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s: string) => s[0]?.toUpperCase())
      .join("") || "U";

  // Get selected team for Stack auth (cast to Team type from Stack)
  // Stabilize the reference so SelectedTeamSwitcher only sees a change when the team ID changes,
  // preventing unnecessary PATCH calls to Stack Auth on every route navigation.
  const selectedTeamRef = useRef<Team | null>(null);
  const rawSelectedTeam = provider === "stack" && getSelectedTeam ? getSelectedTeam() as Team | null : null;
  if (rawSelectedTeam?.id !== selectedTeamRef.current?.id) {
    selectedTeamRef.current = rawSelectedTeam;
  }
  const selectedTeam = selectedTeamRef.current;

  // Version info from app config context
  const versionInfo = config ? { ui: config.uiVersion, api: config.apiVersion } : null;

  // Check for updates only on self-hosted (OSS) deployments — cloud is managed for the user.
  const { latest: latestRelease, isBehind, isLatest } = useLatestReleaseVersion(
    versionInfo?.ui,
    { enabled: config?.deploymentMode === "oss" },
  );

  const isActive = (path: string) => pathname.startsWith(path);

  const handleMobileNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const SidebarLink = ({ item }: { item: SidebarNavItem }) => {
    const isItemActive = isActive(item.url);
    const Icon = item.icon;
    const showWarningDot = item.showsTelephonyWarning && hasTelephonyWarning;
    const tooltip = {
      children: (
        <div className="notranslate" translate="no">
          <p>{item.title}</p>
          {showWarningDot && (
            <p className="text-amber-600 dark:text-amber-400">{TELEPHONY_WARNING_COPY}</p>
          )}
        </div>
      ),
    };
    const warningIndicator = (
      <AlertTriangle
        aria-label="Action required on a telephony configuration"
        className={cn(
          "text-amber-500",
          isCollapsed ? "absolute -right-0.5 -top-0.5 h-3 w-3" : "ml-auto h-3.5 w-3.5"
        )}
      />
    );

    return (
      <SidebarMenuButton
        asChild
        tooltip={tooltip}
        className={cn(
          "h-9 rounded-md text-sidebar-foreground/80 transition-colors",
          "hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
          isItemActive &&
            "bg-background text-foreground font-medium shadow-sm border border-sidebar-border/60 hover:bg-background"
        )}
      >
        <Link
          href={item.url}
          onClick={handleMobileNavClick}
          className={cn("relative", isCollapsed && "justify-center")}
          translate="no"
        >
          <Icon
            className={cn(
              "h-4 w-4 shrink-0",
              isItemActive && "text-primary"
            )}
          />
          <span
            className={cn("notranslate min-w-0 flex-1 truncate", isCollapsed && "sr-only")}
            translate="no"
          >
            {item.title}
          </span>
          {showWarningDot && (
            isCollapsed ? (
              warningIndicator
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  {warningIndicator}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{TELEPHONY_WARNING_COPY}</p>
                </TooltipContent>
              </Tooltip>
            )
          )}
        </Link>
      </SidebarMenuButton>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/70">
      <SidebarHeader className="px-3 py-3 notranslate" translate="no">
        <div className="flex items-center justify-between gap-2">
          <div className={cn("flex items-center gap-2 min-w-0", isCollapsed && "hidden")}>
            <Link
              href="/"
              className="notranslate flex items-center gap-2"
              translate="no"
              aria-label="SawtAI"
            >
              <SawtLogo className="h-11 w-auto" />
              {versionInfo && (
                <span
                  className="notranslate text-[10px] font-normal text-muted-foreground"
                  translate="no"
                >
                  v{versionInfo.ui}
                </span>
              )}
            </Link>
            {isBehind && latestRelease && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://docs.dograh.com/deployment/update"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-900 transition-opacity hover:opacity-80 dark:bg-amber-950 dark:text-amber-200"
                  >
                    <ArrowUpCircle className="h-3 w-3" />
                    Update
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Latest: {latestRelease} — click to see the update guide</p>
                </TooltipContent>
              </Tooltip>
            )}
            {isLatest && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center rounded-md border bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                    Latest
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>You&apos;re running the latest release</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <SidebarTrigger
            className={cn(
              "h-7 w-7 rounded-md border border-transparent text-muted-foreground transition-colors hover:border-sidebar-border/60 hover:bg-background hover:text-foreground",
              isCollapsed && "mx-auto"
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </SidebarTrigger>
        </div>

        {provider === "stack" && (
          <div
            className={cn(
              "mt-3 notranslate rounded-md border border-sidebar-border/60 bg-background shadow-sm",
              isCollapsed && "hidden"
            )}
            translate="no"
          >
            <React.Suspense
              fallback={
                <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
              }
            >
              <StackTeamSwitcher
                selectedTeam={selectedTeam || undefined}
                onChange={() => {
                  router.refresh();
                }}
              />
            </React.Suspense>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={cn("notranslate px-1", isCollapsed && "px-0")} translate="no">
        {NAV_SECTIONS.map((section, index) => (
          <SidebarGroup
            key={section.label ?? "overview"}
            className={index === 0 ? "mt-2" : "mt-4"}
          >
            {section.label && (
              <SidebarGroupLabel
                className={cn(
                  "notranslate px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80",
                  isCollapsed && "hidden"
                )}
                translate="no"
              >
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu>
              {section.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarLink item={item} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter
        className={cn(
          "border-t border-sidebar-border/60 notranslate gap-2",
          isCollapsed ? "p-2" : "p-3"
        )}
        translate="no"
      >
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/usage"
                  aria-label="Trial credits"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
                >
                  <Sparkles className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>
                  {creditsRemaining !== null
                    ? `${creditsRemaining.toLocaleString()} credits left`
                    : "Trial credits"}
                </p>
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Account"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-sidebar-border/60 bg-background text-[10px] font-medium hover:bg-sidebar-accent/70"
                >
                  {initials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    {user?.displayName && (
                      <p className="text-sm font-medium">{user.displayName}</p>
                    )}
                    {email && <p className="text-xs text-muted-foreground">{email}</p>}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {provider === "stack" && (
                  <DropdownMenuItem
                    onClick={() => router.push("/handler/account-settings")}
                    className="cursor-pointer"
                  >
                    <User className="mr-2 h-4 w-4" />
                    Account settings
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => router.push("/settings")}
                  className="cursor-pointer"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Platform Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push("/usage")}
                  className="cursor-pointer"
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Usage
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <ThemeToggle showLabel={false} className="h-8 w-8" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Toggle theme</p>
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Trial credits card */}
            <Link
              href="/usage"
              className="group rounded-md border border-sidebar-border/60 bg-background px-3 py-2 shadow-sm transition-colors hover:border-sidebar-border"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="text-xs font-medium">
                    {billingEnabled ? "Credits" : "Free Trial"}
                  </span>
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              {credits ? (
                <>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{creditsRemaining?.toLocaleString()} left</span>
                    <span>
                      {creditsUsed.toLocaleString()} / {creditsTotal.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={creditsPct} className="mt-1 h-1" />
                </>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">View usage</p>
              )}
            </Link>

            {/* Tokens / billing + Account status */}
            <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
              <Link
                href="/usage"
                className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>Tokens & billing</span>
              </Link>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 gap-1 px-1.5 text-[10px] font-medium",
                  accountStatus === "active"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    accountStatus === "active" ? "bg-emerald-500" : "bg-amber-500"
                  )}
                />
                {accountStatus === "active" ? "Active" : "Trial"}
              </Badge>
            </div>

            {/* Account email row */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex w-full items-center gap-2 rounded-md border border-sidebar-border/60 bg-background px-2 py-1.5 text-left shadow-sm transition-colors hover:border-sidebar-border"
                  aria-label="Account menu"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-[10px] font-medium">
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs">{displayName}</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    {user?.displayName && (
                      <p className="text-sm font-medium">{user.displayName}</p>
                    )}
                    {email && <p className="text-xs text-muted-foreground">{email}</p>}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {provider === "stack" && (
                  <DropdownMenuItem
                    onClick={() => router.push("/handler/account-settings")}
                    className="cursor-pointer"
                  >
                    <User className="mr-2 h-4 w-4" />
                    Account settings
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => router.push("/settings")}
                  className="cursor-pointer"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Platform Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push("/usage")}
                  className="cursor-pointer"
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Usage
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Help | Updates */}
            <div className="flex items-center justify-around gap-1 pt-1 text-xs text-muted-foreground">
              <a
                href="https://docs.dograh.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 transition-colors hover:bg-sidebar-accent/70 hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Help
              </a>
              <span aria-hidden className="h-4 w-px bg-sidebar-border/60" />
              <a
                href={
                  latestRelease
                    ? "https://github.com/dograh/dograh/releases"
                    : "https://docs.dograh.com"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 transition-colors hover:bg-sidebar-accent/70 hover:text-foreground"
              >
                <Megaphone className="h-3.5 w-3.5" />
                Updates
                {isBehind && (
                  <span
                    aria-label="Update available"
                    className="ml-0.5 h-1.5 w-1.5 rounded-full bg-foreground"
                  />
                )}
              </a>
              <span aria-hidden className="h-4 w-px bg-sidebar-border/60" />
              <div className="flex flex-1 items-center justify-center">
                <ThemeToggle showLabel={false} className="h-7 w-7" />
              </div>
            </div>
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
