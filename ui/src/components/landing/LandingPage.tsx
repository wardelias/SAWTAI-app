import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  Check,
  Facebook,
  Globe,
  Instagram,
  Languages,
  Linkedin,
  Menu,
  PhoneCall,
  PhoneIncoming,
  Repeat,
  Target,
  Timer,
  Webhook,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import { SawtLogo } from "@/components/SawtLogo";
import { Button } from "@/components/ui/button";

interface LandingPageProps {
  loginHref: string;
  signupHref?: string;
  /** Set when the visitor is already signed in; swaps the auth CTAs for a dashboard link. */
  dashboardHref?: string;
}

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#pricing", label: "Pricing" },
  { href: "#about", label: "About" },
];

const INTEGRATIONS = [
  { icon: Facebook, label: "Meta Lead Ads" },
  { icon: Instagram, label: "Instagram" },
  { icon: Target, label: "Google Lead Forms" },
  { icon: Linkedin, label: "LinkedIn" },
  { icon: Globe, label: "Web forms" },
  { icon: Webhook, label: "Webhooks" },
];

const PROBLEMS = [
  "Leads go cold while they wait hours for a callback",
  "Your team burns the day dialing numbers that never pick up",
  "After-hours and weekend enquiries simply get lost",
];

const FEATURES = [
  {
    icon: Timer,
    title: "Call every lead in seconds",
    description:
      "The moment someone submits your ad form, Sawt dials them — while your brand is still on their mind.",
  },
  {
    icon: Languages,
    title: "Speaks like your customers",
    description:
      "Natural Arabic and English that follows the caller's dialect and switches language mid-sentence when they do.",
  },
  {
    icon: CalendarCheck,
    title: "Qualifies and books",
    description:
      "Asks your qualifying questions, handles objections, and drops the meeting straight into your calendar.",
  },
  {
    icon: Workflow,
    title: "Design calls visually",
    description:
      "Build the conversation flow on a drag-and-drop canvas. No code, no scripts to babysit.",
  },
  {
    icon: Repeat,
    title: "Follow-up that never forgets",
    description:
      "Automatic retries and multi-step sequences reach the people who missed the first call.",
  },
  {
    icon: BarChart3,
    title: "Every call, measured",
    description:
      "Recordings, transcripts, and outcomes for every conversation, so you know exactly what converts.",
  },
];

const USE_CASES = [
  {
    tag: "Real estate",
    title: "Turn ad clicks into viewings",
    body: "Call every property enquiry instantly, confirm budget and area, and book the viewing before a competitor phones back.",
  },
  {
    tag: "Clinics & services",
    title: "A front desk that never closes",
    body: "Answer and return calls around the clock, collect patient details, and fill your schedule without extra staff.",
  },
  {
    tag: "Sales teams",
    title: "Hand reps only warm conversations",
    body: "Let Sawt do the first touch and the qualifying, so your closers spend their day with buyers who are ready.",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: "Pay as you go",
    blurb: "Prepaid call credits. Ideal for launching your first campaign.",
    features: [
      "Visual call-flow builder",
      "Arabic & English voices",
      "Web and phone test calls",
      "Call recordings & transcripts",
    ],
    cta: "Get started",
    highlighted: false,
  },
  {
    name: "Growth",
    price: "Credits + automation",
    blurb: "For teams running ads who want every lead called automatically.",
    features: [
      "Everything in Starter",
      "Instant calls from Meta lead forms",
      "Campaigns, retries & sequences",
      "Calendar booking",
      "Reports & analytics",
    ],
    cta: "Get started",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    blurb: "High volume, your own numbers, and hands-on setup.",
    features: [
      "Everything in Growth",
      "Bring your own telephony",
      "Custom integrations & webhooks",
      "Dedicated onboarding",
    ],
    cta: "Talk to us",
    highlighted: false,
  },
];

function CallMockup() {
  const lines = [
    { who: "agent", text: "مرحبا أحمد! معك سارة من شركة الريان، شفت إنك سألت عن شقة بدبي مارينا." },
    { who: "lead", text: "أيوه صح، بدي شي غرفتين." },
    { who: "agent", text: "ممتاز. شو الميزانية التقريبية؟ وبيناسبك نحجزلك معاينة بكرا؟" },
    { who: "lead", text: "Tomorrow at 5 works for me." },
  ];

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-cta/20 blur-3xl"
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/10">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cta/15 text-cta">
              <PhoneCall className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium">New lead · Meta form</p>
              <p className="text-xs text-muted-foreground">Called 4s after submit</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Live
          </span>
        </div>

        <div className="flex h-12 items-center justify-center gap-1 border-b border-border px-5">
          {[14, 26, 18, 34, 22, 40, 28, 16, 30, 38, 20, 32, 24, 12, 28, 36, 18, 26].map((h, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-cta/70 animate-pulse"
              style={{ height: `${h}px`, animationDelay: `${i * 90}ms` }}
            />
          ))}
        </div>

        <div className="space-y-3 px-5 py-5">
          {lines.map((line, i) => (
            <div
              key={i}
              className={line.who === "agent" ? "flex justify-start" : "flex justify-end"}
            >
              <p
                dir="auto"
                className={
                  line.who === "agent"
                    ? "max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm"
                    : "max-w-[85%] rounded-2xl rounded-br-sm bg-cta px-3.5 py-2 text-sm text-cta-foreground"
                }
              >
                {line.text}
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-5 py-3 text-xs text-muted-foreground">
          <CalendarCheck className="h-4 w-4 text-cta" />
          Viewing booked · Tomorrow, 5:00 PM · added to calendar
        </div>
      </div>
    </div>
  );
}

export function LandingPage({ loginHref, signupHref, dashboardHref }: LandingPageProps) {
  const signedIn = !!dashboardHref;
  const primaryHref = dashboardHref ?? signupHref ?? loginHref;
  const primaryLabel = signedIn ? "Open dashboard" : "Get started";

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Navigation */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" aria-label="SawtAI home">
            <SawtLogo className="h-8 w-auto text-foreground" />
          </Link>

          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {!signedIn && (
              <Button variant="ghost" asChild>
                <Link href={loginHref}>Sign in</Link>
              </Button>
            )}
            <Button asChild className="bg-cta text-cta-foreground hover:bg-cta/90">
              <Link href={primaryHref}>{primaryLabel}</Link>
            </Button>
          </div>

          {/* Mobile menu: native <details> keeps this a server component */}
          <details className="group relative md:hidden">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md border border-border [&::-webkit-details-marker]:hidden">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open menu</span>
            </summary>
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-popover p-2 shadow-lg">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  {link.label}
                </a>
              ))}
              <div className="mt-2 grid gap-2 border-t border-border pt-2">
                {!signedIn && (
                  <Button variant="outline" asChild>
                    <Link href={loginHref}>Sign in</Link>
                  </Button>
                )}
                <Button asChild className="bg-cta text-cta-foreground hover:bg-cta/90">
                  <Link href={primaryHref}>{primaryLabel}</Link>
                </Button>
              </div>
            </div>
          </details>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-cta/10 to-transparent"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <PhoneIncoming className="h-3.5 w-3.5 text-cta" />
                AI voice agents in Arabic &amp; English
              </span>
              <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
                Call every lead in seconds.{" "}
                <span className="text-cta">Close more without dialing.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                Sawt&apos;s AI voice agents phone your new leads the instant they sign up,
                qualify them in natural Arabic or English, and book the meeting — 24/7,
                at any volume.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  size="lg"
                  asChild
                  className="bg-cta text-cta-foreground shadow-lg shadow-cta/25 transition-transform hover:-translate-y-0.5 hover:bg-cta/90"
                >
                  <Link href={primaryHref}>
                    {primaryLabel} <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="#features">See how it works</a>
                </Button>
              </div>
              {!signedIn && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link href={loginHref} className="font-medium text-foreground underline-offset-4 hover:underline">
                    Sign in
                  </Link>
                </p>
              )}
            </div>
            <CallMockup />
          </div>
        </section>

        {/* Integrations strip */}
        <section className="border-y border-border/60 bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-center text-sm text-muted-foreground">
              Plugs into the lead sources you already run
            </p>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {INTEGRATIONS.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Problem → Solution + Features */}
        <section id="features" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-cta">The problem</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Speed wins the deal. Most leads never get a fast call.
                </h2>
              </div>
              <ul className="space-y-4 self-end">
                {PROBLEMS.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-muted-foreground">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-20 text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-cta">The fix</p>
              <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                An AI caller that works every lead, the moment it lands
              </h2>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="group rounded-2xl border border-border/70 bg-card p-6 transition-all hover:-translate-y-1 hover:border-cta/40 hover:shadow-lg"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cta/15 text-cta transition-colors group-hover:bg-cta group-hover:text-cta-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-medium">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" className="scroll-mt-20 bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
            <div className="text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-cta">Built for</p>
              <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Businesses that live and die by the phone
              </h2>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {USE_CASES.map((uc) => (
                <article
                  key={uc.tag}
                  className="flex flex-col rounded-2xl border border-border/70 bg-card p-7 transition-shadow hover:shadow-lg"
                >
                  <span className="w-fit rounded-full bg-cta/15 px-3 py-1 text-xs font-medium text-cta">
                    {uc.tag}
                  </span>
                  <h3 className="mt-5 text-xl font-medium">{uc.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{uc.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
            <div className="text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-cta">Pricing</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Pay for conversations, not seats
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Buy call credits, top up as you grow. Only pay for the minutes your agents talk.
              </p>
            </div>
            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={
                    plan.highlighted
                      ? "relative flex flex-col rounded-2xl border-2 border-cta bg-card p-8 shadow-xl shadow-cta/10"
                      : "flex flex-col rounded-2xl border border-border/70 bg-card p-8"
                  }
                >
                  {plan.highlighted && (
                    <span className="absolute -top-3 left-8 rounded-full bg-cta px-3 py-1 text-xs font-semibold text-cta-foreground">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-lg font-medium">{plan.name}</h3>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">{plan.price}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{plan.blurb}</p>
                  <ul className="mt-6 flex-1 space-y-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-cta" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    asChild
                    variant={plan.highlighted ? "default" : "outline"}
                    className={plan.highlighted ? "mt-8 bg-cta text-cta-foreground hover:bg-cta/90" : "mt-8"}
                  >
                    <Link href={primaryHref}>{signedIn ? primaryLabel : plan.cta}</Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* About + final CTA */}
        <section id="about" className="scroll-mt-20 px-4 pb-20 sm:px-6 md:pb-28">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-foreground px-6 py-14 text-center text-background sm:px-12 md:py-20">
            <p className="text-sm font-semibold uppercase tracking-wider text-cta">
              Sawt · صوت · “voice”
            </p>
            <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Give every customer a voice that answers — instantly
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-background/70">
              We build AI voice agents for teams in the Middle East and beyond, made to
              sound natural in the languages your customers actually speak.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                asChild
                className="bg-cta text-cta-foreground transition-transform hover:-translate-y-0.5 hover:bg-cta/90"
              >
                <Link href={primaryHref}>
                  {primaryLabel} <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              {!signedIn && (
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background"
                >
                  <Link href={loginHref}>Sign in</Link>
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <SawtLogo className="h-8 w-auto text-foreground" animated={false} />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              AI voice agents that call, qualify, and book your leads in Arabic and English.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="transition-colors hover:text-foreground">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">Account</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {signedIn ? (
                <li>
                  <Link href={primaryHref} className="transition-colors hover:text-foreground">
                    Open dashboard
                  </Link>
                </li>
              ) : (
                <>
                  <li>
                    <Link href={loginHref} className="transition-colors hover:text-foreground">
                      Sign in
                    </Link>
                  </li>
                  <li>
                    <Link href={primaryHref} className="transition-colors hover:text-foreground">
                      Create account
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-border/60 px-4 py-6 text-center text-sm text-muted-foreground sm:px-6">
          © {new Date().getFullYear()} SawtAI. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
