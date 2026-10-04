import clsx from "clsx";
import { ArrowRight, Check, MessageCircle, Phone } from "lucide-react";

import {
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_E164,
  FAQS,
  FEATURES,
  FLOW_STEPS,
  INTEGRATIONS,
  NAV_LINKS,
  PAIN_POINTS,
  PLANS,
  SETUP_STEPS,
  USE_CASES,
  WHATSAPP_URL,
} from "./content";
import { DemoSection } from "./DemoSection";
import styles from "./landing.module.css";
import { LandingNav } from "./LandingNav";
import { LandingShell } from "./LandingShell";
import { StructuredData } from "./StructuredData";

interface LandingPageProps {
  loginHref: string;
  signupHref: string;
  /** Set when the visitor is already signed in; swaps the auth CTAs for a dashboard link. */
  dashboardHref?: string;
  /** Whether /api/demo-call is configured to place outbound demo calls. */
  liveCallEnabled: boolean;
}

const STAGGER = [styles.stagger1, styles.stagger2, styles.stagger3, styles.stagger4, styles.stagger5, styles.stagger6];

// Links into the app (sign in, sign up, dashboard) are plain <a> tags, not
// next/link: a full page load gives the app its auth providers, which the
// landing page renders without (see app/layout.tsx).
export function LandingPage({ loginHref, signupHref, dashboardHref, liveCallEnabled }: LandingPageProps) {
  const signedIn = !!dashboardHref;
  const primaryHref = dashboardHref ?? signupHref;
  const primaryLabel = signedIn ? "Open dashboard" : "Get started";

  return (
    <LandingShell>
      <StructuredData />
      <LandingNav primaryHref={primaryHref} primaryLabel={primaryLabel} loginHref={signedIn ? undefined : loginHref} />

      <main className={styles.main}>
        {/* Hero */}
        <section id="top" aria-labelledby="hero-title" className={clsx(styles.section, styles.hero)}>
          <div className={clsx(styles.orb, styles.orbViolet, styles.orbHero1)} aria-hidden />
          <div className={clsx(styles.orb, styles.orbLavender, styles.orbHero2)} aria-hidden />
          <div className={clsx(styles.container, styles.heroContent)}>
            <p className={clsx(styles.badge, styles.heroIn)}>
              <span className={styles.pulseDot} aria-hidden />
              Now live — AI voice agents for every lead
            </p>
            <h1 id="hero-title" className={clsx(styles.heroIn, styles.heroIn1)}>
              Call every lead in seconds. <span className={styles.gradientText}>Close more without dialing.</span>
            </h1>
            <p className={clsx(styles.subtitle, styles.heroIn, styles.heroIn2)}>
              Sawt&apos;s AI voice agents phone your new leads the instant they sign up, qualify them in natural
              Arabic or English, and book the meeting — 24/7, at any volume.
            </p>
            <div className={clsx(styles.ctaGroup, styles.heroIn, styles.heroIn3)}>
              <a href={primaryHref} className={clsx(styles.btnPrimary, styles.btnLarge)}>
                {primaryLabel}
                <ArrowRight size={18} aria-hidden />
              </a>
              <a href="#how-it-works" className={clsx(styles.btnSecondary, styles.btnLarge)}>
                See how it works
                <span className={styles.icon} aria-hidden>
                  ▶
                </span>
              </a>
            </div>
            {!signedIn && (
              <p className={clsx(styles.heroSignIn, styles.heroIn, styles.heroIn3)}>
                Already have an account? <a href={loginHref}>Sign in</a>
              </p>
            )}
          </div>
        </section>

        {/* Integrations */}
        <section aria-labelledby="integrations-title" className={styles.integrations}>
          <div className={styles.container}>
            <div className={clsx(styles.glassPanel, styles.integrationsPanel, styles.fadeUp)}>
              <p id="integrations-title" className={styles.integrationsLabel}>
                Plugs into the lead sources you already run
              </p>
              <ul className={styles.integrationsList}>
                {INTEGRATIONS.map(({ icon: Icon, label }) => (
                  <li key={label}>
                    <Icon size={18} aria-hidden />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section aria-labelledby="problem-title" className={clsx(styles.section, styles.painPoints)}>
          <div className={clsx(styles.orb, styles.orbViolet, styles.orbSol1)} aria-hidden />
          <div className={clsx(styles.orb, styles.orbLavender, styles.orbSol2)} aria-hidden />
          <div className={styles.container}>
            <div className={clsx(styles.sectionHeader, styles.fadeUp)}>
              <span className={styles.sectionLabel}>The problem</span>
              <h2 id="problem-title" className={styles.title}>
                Speed wins the deal. Most leads never get a fast call.
              </h2>
            </div>
            <div className={styles.statsGrid}>
              {PAIN_POINTS.map((point, i) => (
                <div key={point.stat} className={clsx(styles.glassPanel, styles.statCard, styles.fadeUp, STAGGER[i])}>
                  <div className={styles.statIcon} aria-hidden>
                    {point.icon}
                  </div>
                  <p className={styles.statNumber}>{point.stat}</p>
                  <p>{point.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Solution */}
        <section
          id="how-it-works"
          aria-labelledby="solution-title"
          className={clsx(styles.section, styles.solution)}
        >
          <div className={clsx(styles.orb, styles.orbIndigo, styles.orbSol1)} aria-hidden />
          <div className={styles.container}>
            <div className={clsx(styles.sectionHeader, styles.fadeUp)}>
              <span className={styles.sectionLabel}>The fix</span>
              <h2 id="solution-title" className={styles.title}>
                An AI caller that works every lead, the moment it lands
              </h2>
              <p className={styles.sectionSubtitle}>
                Not a chatbot, not a robocall. Sawt connects to your lead sources, calls each new lead within
                seconds, holds a natural conversation, and books qualified prospects straight into your calendar.
              </p>
            </div>
            <ol className={styles.flowDiagram}>
              {FLOW_STEPS.map((step, i) => (
                <li key={step.title} className={styles.flowItem}>
                  {i > 0 && <span className={clsx(styles.flowConnector, styles.fadeUp, STAGGER[i * 2 - 1])} aria-hidden />}
                  <div className={clsx(styles.glassPanel, styles.flowStep, styles.fadeUp, STAGGER[i * 2])}>
                    <div className={styles.stepIcon} aria-hidden>
                      {step.icon}
                      {step.bubble && <span className={styles.floatingText}>{step.bubble}</span>}
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <DemoSection liveCallEnabled={liveCallEnabled} />

        {/* Features */}
        <section id="features" aria-labelledby="features-title" className={clsx(styles.section, styles.features)}>
          <div className={styles.container}>
            <div className={clsx(styles.sectionHeader, styles.fadeUp)}>
              <span className={styles.sectionLabel}>Features</span>
              <h2 id="features-title" className={styles.title}>
                Everything you need to turn leads into meetings
              </h2>
            </div>
            <div className={styles.featureGrid}>
              {FEATURES.map(({ icon: Icon, title, description }, i) => (
                <article
                  key={title}
                  className={clsx(styles.glassPanel, styles.featureCard, styles.fadeUp, STAGGER[i % 3])}
                >
                  <div className={styles.featureIcon} aria-hidden>
                    <Icon size={22} />
                  </div>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" aria-labelledby="use-cases-title" className={clsx(styles.section, styles.useCases)}>
          <div className={styles.container}>
            <div className={clsx(styles.sectionHeader, styles.fadeUp)}>
              <span className={styles.sectionLabel}>Built for</span>
              <h2 id="use-cases-title" className={styles.title}>
                Businesses that live and die by the phone
              </h2>
            </div>
            <div className={styles.casesGrid}>
              {USE_CASES.map((useCase) => (
                <article key={useCase.tag} className={clsx(styles.glassPanel, styles.caseCard)}>
                  <span className={styles.caseTag}>
                    <span aria-hidden>{useCase.icon}</span>
                    {useCase.tag}
                  </span>
                  <h3>{useCase.title}</h3>
                  <p>{useCase.body}</p>
                  <a href="#demo" className={styles.learnMore}>
                    <span>Hear a sample call</span>
                    <span aria-hidden>→</span>
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Getting started */}
        <section aria-labelledby="setup-title" className={clsx(styles.section, styles.howItWorks)}>
          <div className={styles.container}>
            <div className={clsx(styles.sectionHeader, styles.fadeUp)}>
              <span className={styles.sectionLabel}>Getting started</span>
              <h2 id="setup-title" className={styles.title}>
                Live in days. Not months.
              </h2>
            </div>
            <ol className={styles.timeline}>
              {SETUP_STEPS.map((step, i) => (
                <li key={step.title} className={clsx(styles.timelineItem, styles.fadeUp, STAGGER[i])}>
                  <div className={styles.timelineMarker} aria-hidden>
                    {i + 1}
                  </div>
                  <div
                    className={clsx(
                      styles.glassPanel,
                      styles.timelineContent,
                      i === SETUP_STEPS.length - 1 && styles.completed,
                    )}
                  >
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" aria-labelledby="pricing-title" className={clsx(styles.section, styles.pricing)}>
          <div className={styles.container}>
            <div className={clsx(styles.sectionHeader, styles.fadeUp)}>
              <span className={styles.sectionLabel}>Pricing</span>
              <h2 id="pricing-title" className={styles.title}>
                Pay for conversations, not seats
              </h2>
              <p className={styles.sectionSubtitle}>
                Buy call credits, top up as you grow. Only pay for the minutes your agents talk.
              </p>
            </div>
            <div className={styles.pricingGrid}>
              {PLANS.map((plan, i) => (
                <article
                  key={plan.name}
                  className={clsx(
                    styles.glassPanel,
                    styles.pricingCard,
                    plan.highlighted && styles.recommended,
                    styles.fadeUp,
                    STAGGER[i],
                  )}
                >
                  {plan.highlighted && <span className={styles.recommendedBadge}>Most popular</span>}
                  <h3 className={styles.planName}>{plan.name}</h3>
                  <p className={styles.planPrice}>{plan.price}</p>
                  <p className={styles.planBlurb}>{plan.blurb}</p>
                  <ul className={styles.checkList}>
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <Check size={16} aria-hidden />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {plan.cta.action === "demo" ? (
                    <a href="#book" data-book-demo className={clsx(styles.btnSecondary, styles.btnBlock)}>
                      {plan.cta.label}
                    </a>
                  ) : (
                    <a
                      href={primaryHref}
                      className={clsx(plan.highlighted ? styles.btnPrimary : styles.btnSecondary, styles.btnBlock)}
                    >
                      {signedIn ? primaryLabel : plan.cta.label}
                    </a>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className={clsx(styles.section, styles.faq)}>
          <div className={styles.containerSmall}>
            <div className={clsx(styles.sectionHeader, styles.fadeUp)}>
              <span className={styles.sectionLabel}>FAQ</span>
              <h2 id="faq-title" className={styles.title}>
                Questions, answered
              </h2>
            </div>
            <div className={clsx(styles.faqContainer, styles.fadeUp, styles.stagger1)}>
              {FAQS.map(({ q, a }) => (
                <details key={q} name="faq" className={clsx(styles.glassPanel, styles.faqItem)}>
                  <summary className={styles.faqQuestion}>
                    <h3>{q}</h3>
                    <span className={styles.faqIcon} aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className={styles.faqAnswer}>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section id="book" aria-labelledby="cta-title" className={clsx(styles.section, styles.finalCta)}>
          <div className={clsx(styles.orb, styles.orbViolet, styles.orbCta1)} aria-hidden />
          <div className={clsx(styles.orb, styles.orbIndigo, styles.orbCta2)} aria-hidden />
          <div className={clsx(styles.container, styles.sectionHeader, styles.fadeUp)}>
            <span className={styles.sectionLabel}>
              Sawt · <span lang="ar">صوت</span> · “voice”
            </span>
            <h2 id="cta-title" className={styles.title}>
              Stop losing leads. Start closing.
            </h2>
            <p className={styles.sectionSubtitle}>
              Give every lead a voice that answers — instantly. Launch your AI caller today, or book a
              15-minute demo and we&apos;ll show you exactly how it works for your business.
            </p>
            <div className={clsx(styles.glassPanel, styles.ctaForm)}>
              <div className={styles.ctaButtons}>
                <a href={primaryHref} className={clsx(styles.btnPrimary, styles.btnLarge, styles.btnBlock)}>
                  {primaryLabel}
                  <ArrowRight size={18} aria-hidden />
                </a>
                <a
                  href="#book"
                  data-book-demo
                  className={clsx(styles.btnSecondary, styles.btnLarge, styles.btnBlock)}
                >
                  Book a 15-minute demo
                </a>
              </div>
              <div className={styles.ctaAlt}>
                <span>or reach us directly</span>
                <a href={`tel:${CONTACT_PHONE_E164}`} dir="ltr" className={styles.accentText}>
                  <Phone size={18} aria-hidden />
                  {CONTACT_PHONE_DISPLAY}
                </a>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={styles.accentText}>
                  <MessageCircle size={18} aria-hidden />
                  WhatsApp
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerContent}>
            <p className={styles.footerCopyright}>© {new Date().getFullYear()} Sawt AI</p>
            <nav aria-label="Footer" className={styles.footerLinks}>
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
              <a href="#book">Contact</a>
              <a href={primaryHref}>{signedIn ? "Dashboard" : "Sign up"}</a>
              {!signedIn && <a href={loginHref}>Sign in</a>}
            </nav>
            <div className={styles.footerSocial}>
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
                WA
              </a>
            </div>
          </div>
          <p className={styles.footerBottom}>
            AI voice agents that call, qualify and book your leads — in English, Arabic &amp; Hebrew.
          </p>
        </div>
      </footer>
    </LandingShell>
  );
}
