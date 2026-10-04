"use client";

import clsx from "clsx";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { DEMO_AI_PHONE_DISPLAY, DEMO_AI_PHONE_E164, DEMO_SCENARIOS } from "./content";
import styles from "./landing.module.css";

const WAVE_BAR_COUNT = 20;
const IDLE_BARS: number[] = Array(WAVE_BAR_COUNT).fill(3);
const LINE_INTERVAL_MS = 1400;

type CallStatus = "idle" | "loading" | "success" | "error";

const CALL_ERRORS: Record<number, string> = {
  400: "Please enter a valid Israeli phone number.",
  429: "Too many attempts. Please try again in a few minutes.",
};

interface DemoSectionProps {
  /** Whether /api/demo-call is configured, i.e. the "Call me" form can place a call. */
  liveCallEnabled: boolean;
}

export function DemoSection({ liveCallEnabled }: DemoSectionProps) {
  const [scenarioId, setScenarioId] = useState(DEMO_SCENARIOS[0].id);
  const [mode, setMode] = useState<"sample" | "live">("sample");
  // Lines revealed so far while replaying the call; null = idle, whole transcript shown.
  const [playback, setPlayback] = useState<number | null>(null);
  const [bars, setBars] = useState(IDLE_BARS);
  const [phone, setPhone] = useState("");
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callError, setCallError] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const scenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId) ?? DEMO_SCENARIOS[0];
  const playing = playback !== null;
  const visibleLines = playing ? scenario.lines.slice(0, playback) : scenario.lines;

  useEffect(() => {
    if (playback === null) return;
    if (playback >= scenario.lines.length) {
      const id = setTimeout(() => setPlayback(null), LINE_INTERVAL_MS);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setPlayback(playback + 1), playback === 0 ? 300 : LINE_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [playback, scenario.lines.length]);

  useEffect(() => {
    if (!playing) {
      setBars(IDLE_BARS);
      return;
    }
    const id = setInterval(() => {
      setBars((prev) => prev.map(() => Math.random() * 30 + 10));
    }, 100);
    return () => clearInterval(id);
  }, [playing]);

  // Keep the newest line in view while replaying (scrolls the panel, not the page).
  useEffect(() => {
    const panel = transcriptRef.current;
    if (panel && playback !== null) panel.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
  }, [playback]);

  useEffect(() => {
    if (callStatus !== "success" && callStatus !== "error") return;
    const id = setTimeout(() => setCallStatus("idle"), 6000);
    return () => clearTimeout(id);
  }, [callStatus]);

  const selectScenario = (id: string) => {
    setScenarioId(id);
    setPlayback(null);
    transcriptRef.current?.scrollTo({ top: 0 });
  };

  const handleCall = async (event: FormEvent) => {
    event.preventDefault();
    if (!phone.trim()) return;
    setCallStatus("loading");
    try {
      const response = await fetch("/api/demo-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (response.ok) {
        setCallStatus("success");
        return;
      }
      setCallError(CALL_ERRORS[response.status] ?? "We couldn't start the call. Please try again.");
      setCallStatus("error");
    } catch {
      setCallError("We couldn't start the call. Please try again.");
      setCallStatus("error");
    }
  };

  return (
    <section id="demo" aria-labelledby="demo-title" className={clsx(styles.section, styles.demoSection)}>
      <div className={styles.container}>
        <div className={clsx(styles.sectionHeader, styles.fadeUp)}>
          <span className={styles.sectionLabel}>Hear it in action</span>
          <h2 id="demo-title" className={styles.title}>
            Listen in on a real lead call
          </h2>
          <p className={styles.sectionSubtitle}>
            Pick an industry to see how Sawt qualifies and books a lead in under a minute — in English,
            Arabic or Hebrew.
          </p>
        </div>

        <div className={clsx(styles.demoTabs, styles.fadeUp, styles.stagger1)}>
          {DEMO_SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={scenarioId === s.id}
              className={clsx(styles.tabBtn, scenarioId === s.id && styles.active)}
              onClick={() => selectScenario(s.id)}
            >
              {s.tab}
            </button>
          ))}
        </div>

        <div className={clsx(styles.glassPanel, styles.demoContainer, styles.fadeUp, styles.stagger2)}>
          <div className={styles.demoColumns}>
            <div>
              <div className={styles.columnHeader}>
                <h3 className={styles.columnTitle}>Call transcript</h3>
                <span className={styles.legend} aria-hidden>
                  <span className={styles.legendAi}>Sawt AI</span>
                  <span className={styles.legendLead}>Lead</span>
                </span>
              </div>
              <div
                ref={transcriptRef}
                className={styles.transcriptPanel}
                dir={scenario.dir}
                lang={scenario.language === "Arabic" ? "ar" : scenario.language === "Hebrew" ? "he" : "en"}
              >
                {visibleLines.map((line, i) => (
                  <p
                    key={`${scenario.id}-${i}`}
                    className={clsx(styles.msg, line.speaker === "ai" ? styles.msgAi : styles.msgLead)}
                  >
                    <span className={styles.msgTime}>{line.time}</span>
                    <span className={styles.srOnly}>{line.speaker === "ai" ? "Sawt AI: " : "Lead: "}</span>
                    {line.text}
                  </p>
                ))}
                {playback !== null && playback < scenario.lines.length && (
                  <p
                    aria-hidden
                    className={clsx(
                      styles.msg,
                      styles.typing,
                      scenario.lines[playback].speaker === "ai" ? styles.msgAi : styles.msgLead,
                    )}
                  >
                    <span />
                    <span />
                    <span />
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className={styles.columnHeader}>
                <h3 className={styles.columnTitle}>Phone call</h3>
                <div className={styles.demoModeToggle}>
                  <button
                    type="button"
                    aria-pressed={mode === "sample"}
                    className={clsx(styles.modeToggleBtn, mode === "sample" && styles.active)}
                    onClick={() => setMode("sample")}
                  >
                    Sample
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "live"}
                    className={clsx(styles.modeToggleBtn, mode === "live" && styles.active)}
                    onClick={() => setMode("live")}
                  >
                    Live
                  </button>
                </div>
              </div>

              <div className={styles.phoneContainer}>
                {mode === "sample" ? (
                  <>
                    <div className={styles.glassPanelInner}>
                      <div className={styles.playerHeader}>
                        <div className={styles.playerIcon} aria-hidden>
                          📞
                        </div>
                        <div className={styles.playerInfo}>
                          <div className={styles.playerTitle}>AI voice agent</div>
                          <div className={styles.playerLang}>{scenario.language} · outbound call</div>
                        </div>
                        <div className={styles.playerTimer}>
                          {playback ? scenario.lines[playback - 1].time : scenario.duration}
                        </div>
                      </div>
                      <div className={clsx(styles.waveform, playing && styles.playing)} aria-hidden>
                        {bars.map((height, i) => (
                          <div key={i} className={styles.bar} style={{ height: `${height}px` }} />
                        ))}
                      </div>
                      <button
                        type="button"
                        className={clsx(styles.playBtn, playing && styles.playing)}
                        onClick={() => setPlayback(playing ? null : 0)}
                      >
                        <span aria-hidden>{playing ? "⏸" : "▶"}</span>
                        {playing ? "Stop replay" : "Replay the call"}
                      </button>
                    </div>
                    <div className={clsx(styles.glassPanelInner, styles.outcomeCard)}>
                      <p className={styles.outcomeCaption}>Call outcome</p>
                      <p className={styles.outcomeTitle}>
                        <span aria-hidden>✅</span> {scenario.outcome}
                      </p>
                      <p className={styles.outcomeDetail}>{scenario.outcomeDetail}</p>
                      <ul className={styles.outcomeTags}>
                        <li>Recording</li>
                        <li>Transcript</li>
                        <li>Added to calendar</li>
                      </ul>
                    </div>
                  </>
                ) : (
                  <div className={clsx(styles.glassPanelInner, styles.liveDemoContainer)}>
                    <h4 className={styles.liveTitle}>Talk to a Sawt agent right now</h4>
                    {liveCallEnabled && (
                      <>
                        <div className={styles.liveOption}>
                          <span className={styles.optionLabel}>Call me</span>
                          <form className={styles.callMeForm} onSubmit={handleCall}>
                            <input
                              type="tel"
                              inputMode="tel"
                              dir="ltr"
                              autoComplete="tel"
                              required
                              aria-label="Your phone number"
                              placeholder="+972 50 000 0000"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              className={styles.phoneInput}
                            />
                            <button
                              type="submit"
                              disabled={callStatus === "loading"}
                              className={clsx(
                                styles.callBtn,
                                callStatus === "success" && styles.success,
                                callStatus === "error" && styles.error,
                              )}
                            >
                              {callStatus === "loading" ? "Connecting..." : "Call me"}
                            </button>
                          </form>
                          {callStatus === "success" && (
                            <p role="status" className={clsx(styles.statusMsg, styles.success)}>
                              Calling you now — pick up!
                            </p>
                          )}
                          {callStatus === "error" && (
                            <p role="alert" className={clsx(styles.statusMsg, styles.error)}>
                              {callError}
                            </p>
                          )}
                        </div>
                        <div className={styles.divider}>
                          <span>or</span>
                        </div>
                      </>
                    )}
                    <div className={styles.liveOption}>
                      <span className={styles.optionLabel}>Call the AI</span>
                      <a href={`tel:${DEMO_AI_PHONE_E164}`} className={styles.aiPhoneNumberBtn}>
                        Call Daniel: {DEMO_AI_PHONE_DISPLAY}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={clsx(styles.demoCta, styles.fadeUp, styles.stagger3)}>
          <a href="#book" data-book-demo className={styles.inlineLink}>
            <span>Want to hear it for your business?</span>
            <span aria-hidden>→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
