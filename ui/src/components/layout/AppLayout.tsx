"use client";

import { CircleDollarSign, LogOut, Menu, Settings, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import type { LocalUser } from "@/lib/auth";
import { useAuth } from "@/lib/auth";

import { AppSidebar } from "./AppSidebar";

function ProfileDropdown() {
  const router = useRouter();
  const { provider, user, logout } = useAuth();

  const initials = (
    user?.displayName ||
    (user as LocalUser | undefined)?.email ||
    (user as { primaryEmail?: string })?.primaryEmail ||
    ""
  )
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase())
    .join("") || "U";

  const email =
    (user as LocalUser | undefined)?.email ||
    (user as { primaryEmail?: string })?.primaryEmail;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full border">
          <span className="text-xs font-medium">{initials}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            {user?.displayName && (
              <p className="text-sm font-medium">{user.displayName}</p>
            )}
            {email && (
              <p className="text-xs text-muted-foreground">{email}</p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {provider === "stack" && (
          <DropdownMenuItem onClick={() => router.push("/handler/account-settings")} className="cursor-pointer">
            <User className="mr-2 h-4 w-4" />
            Account settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
          <Settings className="mr-2 h-4 w-4" />
          Platform Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/usage")} className="cursor-pointer">
          <CircleDollarSign className="mr-2 h-4 w-4" />
          Usage
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppHeader() {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b bg-background px-4 py-2">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Open menu" className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
        <Link href="/" className="text-lg font-bold md:hidden">SawtAI</Link>
      </div>
      <div className="flex items-center gap-3">
        <ProfileDropdown />
      </div>
    </header>
  );
}

interface AppLayoutProps {
  children: ReactNode;
  headerActions?: ReactNode;
  stickyTabs?: ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  headerActions,
  stickyTabs,
}) => {
  const pathname = usePathname();

  // Check if current route should have sidebar
  // Hide sidebar for root (/), /handler routes (Stack Auth routes), and /auth routes
  const shouldShowSidebar = pathname !== "/" && !pathname.startsWith("/handler") && !pathname.startsWith("/auth");

  // Only match the exact editor page /workflow/<id>, not sub-routes like /workflow/<id>/runs
  const isWorkflowEditor = /^\/workflow\/\d+$/.test(pathname);

  // Always render SidebarProvider to keep the component tree shape consistent
  // across route changes (avoids React hooks ordering violations during navigation).
  return (
    <SidebarProvider defaultOpen>
      {shouldShowSidebar ? (
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <SidebarInset className="flex-1">
            {!isWorkflowEditor && <AppHeader />}
            {/* Optional header area for specific pages */}
            {headerActions && (
              <header className="sticky top-0 z-50 w-full border-b bg-background">
                <div className="container mx-auto px-4 py-4">
                  <div className="flex items-center justify-center">
                    {headerActions}
                  </div>
                </div>
              </header>
            )}

            {/* Optional sticky tabs */}
            {stickyTabs && (
              <div className="sticky top-0 z-40 bg-[#2a2e39] border-b border-gray-700">
                <div className="container mx-auto px-4">
                  <div className="flex items-center justify-center py-2">
                    {stickyTabs}
                  </div>
                </div>
              </div>
            )}

            {/* Main content area */}
            <main className="flex-1">
              {children}
            </main>
          </SidebarInset>
        </div>
      ) : (
        <div className="flex-1 w-full">
          {children}
        </div>
      )}
    </SidebarProvider>
  );
};

export default AppLayout;
