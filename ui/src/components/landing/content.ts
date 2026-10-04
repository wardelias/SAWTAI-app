// Copy, contact details and sample calls for the marketing landing page.

import {
  BarChart3,
  CalendarCheck,
  Facebook,
  Globe,
  Instagram,
  Languages,
  Linkedin,
  type LucideIcon,
  Repeat,
  Target,
  Timer,
  Webhook,
  Workflow,
} from "lucide-react";

export { SITE_URL } from "@/lib/site";

export const SEO_TITLE = "Sawt AI — AI Voice Agents That Call Every Lead in Seconds";
export const SEO_DESCRIPTION =
  "Sawt's AI voice agents call new leads seconds after they sign up, qualify them in natural English or Arabic, and book the meeting — 24/7, at any volume.";

export const CONTACT_PHONE_E164 = "+972544799652";
export const CONTACT_PHONE_DISPLAY = "+972-54-479-9652";
export const WHATSAPP_URL = "https://wa.me/972544799652";

/** Inbound number visitors can dial to talk to the demo agent ("Call AI"). */
export const DEMO_AI_PHONE_E164 = "+97233823299";
export const DEMO_AI_PHONE_DISPLAY = "+972-3-382-3299";

/** CRM webhook that receives "Book a demo" form submissions. */
export const DEMO_BOOKING_WEBHOOK_URL =
  "https://services.leadconnectorhq.com/hooks/5mx08gT5SXJptjzoBMQ9/webhook-trigger/36aa89fe-2406-45f1-8418-c7fa4c1203c5";

export const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export const INTEGRATIONS: { icon: LucideIcon; label: string }[] = [
  { icon: Facebook, label: "Meta Lead Ads" },
  { icon: Instagram, label: "Instagram" },
  { icon: Target, label: "Google Lead Forms" },
  { icon: Linkedin, label: "LinkedIn" },
  { icon: Globe, label: "Web forms" },
  { icon: Webhook, label: "Webhooks" },
];

export const PAIN_POINTS = [
  { icon: "⏱", stat: "78%", text: "of leads go cold when nobody responds within 5 minutes" },
  { icon: "📵", stat: "Hours", text: "is how long most leads wait for a callback — while a competitor calls first" },
  { icon: "🔄", stat: "3+ hrs/day", text: "burned by your team dialing numbers that never pick up" },
  { icon: "🌙", stat: "24/7", text: "is when enquiries arrive — after-hours and weekend leads simply get lost" },
];

export const FLOW_STEPS = [
  {
    icon: "💬",
    title: "1. A lead comes in",
    body: "From Meta ads, Google, your website or any webhook — Sawt picks it up the moment the form is submitted.",
  },
  {
    icon: "🧠",
    title: "2. Sawt calls and qualifies",
    body: "A natural phone conversation within seconds: your qualifying questions, objection handling, and real answers.",
    bubble: "Hello",
  },
  {
    icon: "📅",
    title: "3. The meeting is booked",
    body: "Qualified leads land straight in your calendar with a recording and transcript. You show up and close.",
  },
];

export const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
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
    description: "Build the conversation flow on a drag-and-drop canvas. No code, no scripts to babysit.",
  },
  {
    icon: Repeat,
    title: "Follow-up that never forgets",
    description: "Automatic retries and multi-step sequences reach the people who missed the first call.",
  },
  {
    icon: BarChart3,
    title: "Every call, measured",
    description:
      "Recordings, transcripts, and outcomes for every conversation, so you know exactly what converts.",
  },
];

export const USE_CASES = [
  {
    icon: "🏠",
    tag: "Real estate",
    title: "Turn ad clicks into viewings",
    body: "Call every property enquiry instantly, confirm budget and area, and book the viewing before a competitor phones back.",
  },
  {
    icon: "🩺",
    tag: "Clinics & services",
    title: "A front desk that never closes",
    body: "Answer and return calls around the clock, collect patient details, and fill your schedule without extra staff.",
  },
  {
    icon: "📈",
    tag: "Sales teams",
    title: "Hand reps only warm conversations",
    body: "Let Sawt do the first touch and the qualifying, so your closers spend their day with buyers who are ready.",
  },
  {
    icon: "✨",
    tag: "Beauty & wellness",
    title: "Fill every chair",
    body: "Book, confirm and remind clients by phone, so last-minute gaps get filled and no-shows drop.",
  },
  {
    icon: "⚖️",
    tag: "Law firms",
    title: "Screen enquiries before you pick up",
    body: "Collect case details from every potential client and schedule consultations automatically.",
  },
  {
    icon: "🚗",
    tag: "Auto dealerships",
    title: "From ad to test drive in one call",
    body: "Capture test-drive requests, check financing intent, and book showroom visits while interest is hot.",
  },
];

export interface Plan {
  name: string;
  price: string;
  blurb: string;
  features: string[];
  highlighted: boolean;
  /** "signup" goes to the primary CTA; "demo" opens the book-a-demo form. */
  cta: { label: string; action: "signup" | "demo" };
}

export const PLANS: Plan[] = [
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
    highlighted: false,
    cta: { label: "Get started", action: "signup" },
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
    highlighted: true,
    cta: { label: "Get started", action: "signup" },
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
    highlighted: false,
    cta: { label: "Talk to us", action: "demo" },
  },
];

export const SETUP_STEPS = [
  {
    title: "Connect your lead sources",
    body: "Link Meta Lead Ads, Google Lead Forms, your website or any webhook. New leads flow in automatically.",
  },
  {
    title: "Design the conversation",
    body: "Build the call on a visual canvas: your pitch, qualifying questions, objection handling and booking rules.",
  },
  {
    title: "Test it yourself",
    body: "Place web and phone test calls, listen back, and fine-tune until it sounds like your best rep.",
  },
  {
    title: "Go live",
    body: "Every new lead gets a call within seconds, around the clock. You focus on closing.",
  },
];

export const FAQS = [
  {
    q: "How fast does Sawt call a new lead?",
    a: "Within seconds. As soon as someone submits your Meta lead form, web form or any connected source, Sawt dials them — while your brand is still on their mind. Leads who miss the first call are retried automatically.",
  },
  {
    q: "Does the AI really sound natural?",
    a: "Yes. Sawt uses natural, low-latency voices and holds a real conversation: it listens, handles interruptions and objections, and answers questions instead of reading a script.",
  },
  {
    q: "Which languages does Sawt speak?",
    a: "English and Arabic out of the box, including regional dialects, plus Hebrew. Agents can follow the caller's language and switch mid-conversation when they do.",
  },
  {
    q: "Can calls come from my own phone number?",
    a: "Yes. Use a number from Sawt or connect your own telephony provider, so leads see a caller ID they recognize.",
  },
  {
    q: "What happens if the AI can't answer a question?",
    a: "You decide in the call flow: transfer to your team, schedule a callback, or wrap up politely. Every call is recorded and transcribed, so nothing gets lost.",
  },
  {
    q: "How does pricing work?",
    a: "You buy call credits and only pay for the minutes your agents actually talk — no per-seat fees. Top up as you grow, or talk to us about volume pricing.",
  },
  {
    q: "Can I try it before committing?",
    a: "Yes. Create an account, build your first agent, and place web or phone test calls before going live. Prefer a walkthrough? Book a 15-minute demo.",
  },
];

export interface DemoLine {
  speaker: "ai" | "lead";
  text: string;
  time: string;
}

export interface DemoScenario {
  id: string;
  tab: string;
  language: string;
  dir: "ltr" | "rtl";
  lines: DemoLine[];
  duration: string;
  outcome: string;
  outcomeDetail: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "realestate",
    tab: "🏠 Real estate",
    language: "English",
    dir: "ltr",
    duration: "0:41",
    outcome: "Viewing booked · Tomorrow, 5:00 PM",
    outcomeDetail: "Budget up to $650k · Buying to live in · Hot lead",
    lines: [
      { speaker: "ai", time: "0:01", text: "Hi Sarah, it's Maya from Harbor Realty — you just asked about the two-bedroom on Marina Drive. Is now a good time?" },
      { speaker: "lead", time: "0:07", text: "Wow, that was fast. Yes — is it still available?" },
      { speaker: "ai", time: "0:10", text: "It is: fourth floor, sea-facing balcony, listed at $640,000. What budget are you working with?" },
      { speaker: "lead", time: "0:17", text: "Up to about 650." },
      { speaker: "ai", time: "0:20", text: "That fits. Are you buying to live in, or as an investment?" },
      { speaker: "lead", time: "0:24", text: "To live in. We're moving this summer." },
      { speaker: "ai", time: "0:28", text: "Perfect. I can book a viewing tomorrow at 5 PM or Saturday at 11. Which works better?" },
      { speaker: "lead", time: "0:34", text: "Tomorrow at 5." },
      { speaker: "ai", time: "0:36", text: "Done — I'll text you the address and a confirmation. See you tomorrow!" },
    ],
  },
  {
    id: "dental",
    tab: "🦷 Dental clinic",
    language: "English",
    dir: "ltr",
    duration: "0:34",
    outcome: "Appointment booked · Tomorrow, 10:00 AM",
    outcomeDetail: "Urgent · In pain for a week · Reminder scheduled",
    lines: [
      { speaker: "ai", time: "0:01", text: "Hi Daniel, it's Ava from Bright Smile Dental. You filled in our form about a root canal — do you have a minute?" },
      { speaker: "lead", time: "0:06", text: "Yes, sure." },
      { speaker: "ai", time: "0:08", text: "Are you in pain right now, or is this a planned treatment?" },
      { speaker: "lead", time: "0:12", text: "It's been hurting for about a week." },
      { speaker: "ai", time: "0:15", text: "Sorry to hear that — let's get you in quickly. Dr. Cohen has an opening tomorrow at 10 AM. Does that work?" },
      { speaker: "lead", time: "0:22", text: "Yes, perfect." },
      { speaker: "ai", time: "0:24", text: "You're booked. I'll text you a reminder tomorrow morning. Feel better soon!" },
    ],
  },
  {
    id: "beauty",
    tab: "💇 Beauty salon",
    language: "Hebrew",
    dir: "rtl",
    duration: "0:42",
    outcome: "Appointment booked · Thursday, 2:00 PM",
    outcomeDetail: "Long-hair straightening · ₪550 · Conducted in Hebrew",
    lines: [
      { speaker: "ai", time: "0:01", text: "היי נועה, מדברת מאיה מסטודיו ביוטי. ראיתי שהשארת פרטים על החלקה — זה זמן טוב?" },
      { speaker: "lead", time: "0:06", text: "כן, כמה זה עולה?" },
      { speaker: "ai", time: "0:08", text: "החלקה מתחילה מ-₪350 לשיער קצר ו-₪550 לשיער ארוך. מה אורך השיער שלך?" },
      { speaker: "lead", time: "0:14", text: "ארוך, מתחת לכתפיים." },
      { speaker: "ai", time: "0:17", text: "אז ₪550, וזה לוקח בערך שלוש שעות. יש מקום ביום שלישי ב-11:00 או בחמישי ב-14:00." },
      { speaker: "lead", time: "0:25", text: "חמישי בבקשה." },
      { speaker: "ai", time: "0:27", text: "מעולה, קבעתי לך לחמישי ב-14:00 עם מיכל. נתראה!" },
    ],
  },
  {
    id: "medical",
    tab: "✈️ Medical tourism",
    language: "Arabic",
    dir: "rtl",
    duration: "0:55",
    outcome: "Video consultation booked · Tomorrow",
    outcomeDetail: "4 dental implants · Travelling from Qatar · Conducted in Arabic",
    lines: [
      { speaker: "ai", time: "0:01", text: "مرحباً أحمد، معك سارة من مركز زراعة الأسنان. رأيت أنك سألت عن الزراعة، هل الوقت مناسب؟" },
      { speaker: "lead", time: "0:07", text: "نعم، كم السعر؟" },
      { speaker: "ai", time: "0:09", text: "تبدأ الزرعة الواحدة من 750 دولاراً شاملة التاج. كم زرعة تحتاج؟" },
      { speaker: "lead", time: "0:15", text: "أحتاج 4 زرعات في الفك العلوي." },
      { speaker: "ai", time: "0:19", text: "التكلفة التقريبية بين 3000 و4000 دولار، وتشمل استشارة مجانية وأشعة بانورامية. من أين ستأتي؟" },
      { speaker: "lead", time: "0:28", text: "من قطر." },
      { speaker: "ai", time: "0:30", text: "رائع، يمكننا ترتيب الاستقبال من المطار والفندق. هل أحجز لك استشارة فيديو مجانية مع الطبيب غداً؟" },
      { speaker: "lead", time: "0:39", text: "نعم من فضلك." },
      { speaker: "ai", time: "0:41", text: "تم الحجز. ستصلك رسالة بالتفاصيل خلال ساعة. شكراً لك!" },
    ],
  },
];
