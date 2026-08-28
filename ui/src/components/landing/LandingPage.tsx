import { ArrowRight, Phone, Workflow, Zap } from "lucide-react";
import Link from "next/link";

import { SawtLogo } from "@/components/SawtLogo";
import { Button } from "@/components/ui/button";

interface LandingPageProps {
  loginHref: string;
  signupHref?: string;
}

const FEATURES = [
  {
    icon: Workflow,
    title: "Build without code",
    description: "Design conversational voice agents with a visual workflow builder.",
  },
  {
    icon: Phone,
    title: "Call at scale",
    description: "Connect telephony or WebRTC and let your agents handle real calls.",
  },
  {
    icon: Zap,
    title: "Deploy in minutes",
    description: "Go from idea to a live voice agent without managing infrastructure.",
  },
];

export function LandingPage({ loginHref, signupHref }: LandingPageProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <SawtLogo className="h-8 w-auto text-foreground" />
        <nav className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link href={loginHref}>Sign in</Link>
          </Button>
          <Button asChild>
            <Link href={signupHref ?? loginHref}>Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center sm:px-10">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Build voice AI agents that actually talk to your customers
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          Sawt is an open-source platform for designing, testing, and deploying
          conversational voice agents over phone calls and web.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href={signupHref ?? loginHref}>
              Get started <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href={loginHref}>Sign in</Link>
          </Button>
        </div>

        <div className="mt-20 grid w-full max-w-4xl gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-6 text-center"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cta/15 text-cta">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="font-medium">{feature.title}</h2>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-sm text-muted-foreground sm:px-10">
        © {new Date().getFullYear()} Sawt. Open source voice AI.
      </footer>
    </div>
  );
}
