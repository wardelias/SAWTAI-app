import { ChevronRight } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Phone-only list that replaces wide tables below the md breakpoint.
 * Render the desktop table with `max-md:hidden` next to it.
 */
function MobileList({ className, ...props }: React.ComponentProps<"ul">) {
    return (
        <ul
            data-slot="mobile-list"
            className={cn("divide-y divide-border/60 md:hidden", className)}
            {...props}
        />
    )
}

interface MobileListItemProps {
    title: React.ReactNode
    subtitle?: React.ReactNode
    meta?: React.ReactNode
    leading?: React.ReactNode
    trailing?: React.ReactNode
    /** Buttons shown beside the row, outside its link (e.g. play recording). */
    action?: React.ReactNode
    href?: string
    onClick?: () => void
    className?: string
    children?: React.ReactNode
}

function MobileListItem({
    title,
    subtitle,
    meta,
    leading,
    trailing,
    action,
    href,
    onClick,
    className,
    children,
}: MobileListItemProps) {
    const interactive = Boolean(href || onClick)
    const body = (
        <>
            {leading && <span className="shrink-0">{leading}</span>}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{title}</span>
                {subtitle && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
                )}
                {meta && <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">{meta}</span>}
            </span>
            {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
            {interactive && !action && (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
            )}
        </>
    )
    const rowClass =
        "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors active:bg-muted/70"

    return (
        <li data-slot="mobile-list-item" className={className}>
            <div className="-mx-2 flex items-center">
                {href ? (
                    <Link href={href} className={rowClass}>
                        {body}
                    </Link>
                ) : onClick ? (
                    <button type="button" onClick={onClick} className={rowClass}>
                        {body}
                    </button>
                ) : (
                    <div className={cn(rowClass, "active:bg-transparent")}>{body}</div>
                )}
                {action && <div className="flex shrink-0 items-center gap-1.5 pr-2">{action}</div>}
            </div>
            {children && <div className="pb-3">{children}</div>}
        </li>
    )
}

function MobileListIcon({ className, ...props }: React.ComponentProps<"span">) {
    return (
        <span
            className={cn(
                "flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-[18px]",
                className
            )}
            {...props}
        />
    )
}

export { MobileList, MobileListIcon, MobileListItem }
