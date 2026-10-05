/** Section titles for the phone top bar, keyed by the first path segment. */
const SECTION_TITLES: Record<string, string> = {
    overview: "Overview",
    calendar: "Calendar",
    leads: "Leads",
    sequences: "Sequences",
    campaigns: "Campaigns",
    marketing: "Marketing",
    workflow: "Agents",
    "model-configurations": "Models",
    "telephony-configurations": "Telephony",
    tools: "Tools",
    files: "Files",
    recordings: "Recordings",
    "api-keys": "Developers",
    usage: "Agent Runs",
    billing: "Billing",
    reports: "Reports",
    settings: "Settings",
    automation: "Automation",
    superadmin: "Superadmin",
};

export function getMobileSectionTitle(pathname: string): string {
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] === "workflow" && segments[1] === "create") return "Create with AI";
    if (segments[0] === "workflow" && segments[2] === "runs") return "Agent runs";
    if (segments[0] === "workflow" && segments[2] === "run") return "Call";
    if (segments[0] === "workflow" && segments[2] === "settings") return "Agent settings";
    return SECTION_TITLES[segments[0] ?? ""] ?? "SawtAI";
}

/** Nested pages (e.g. /campaigns/12) get a back button instead of the logo. */
export function isNestedPath(pathname: string): boolean {
    return pathname.split("/").filter(Boolean).length >= 2;
}

/** The agent editor (/workflow/<id>) is a full-screen canvas with its own chrome. */
export function isWorkflowEditorPath(pathname: string): boolean {
    return /^\/workflow\/\d+$/.test(pathname);
}
