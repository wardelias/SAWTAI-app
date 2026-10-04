"use client";

import clsx from "clsx";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";

import { trackMetaLead } from "@/lib/metaPixel";

import styles from "./landing.module.css";

type BookingStatus = "idle" | "submitting" | "success" | "error";

// `website` is a honeypot: hidden from people, filled in by bots, rejected server-side.
const EMPTY_BOOKING = { name: "", email: "", phone: "", company: "", website: "" };

const FIELDS: {
  name: Exclude<keyof typeof EMPTY_BOOKING, "website">;
  type: string;
  label: string;
  autoComplete: string;
  inputMode?: "email" | "tel";
}[] = [
  { name: "name", type: "text", label: "Name", autoComplete: "name" },
  { name: "email", type: "email", label: "Work email", autoComplete: "email", inputMode: "email" },
  { name: "phone", type: "tel", label: "Phone number", autoComplete: "tel", inputMode: "tel" },
  { name: "company", type: "text", label: "Company name", autoComplete: "organization" },
];

export function DemoBookingModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState(EMPTY_BOOKING);
  const [status, setStatus] = useState<BookingStatus>("idle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (status !== "success") return;
    const id = setTimeout(onClose, 3000);
    return () => clearTimeout(id);
  }, [status, onClose]);

  const update = (event: ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("submitting");
    try {
      const response = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      setStatus("success");
      trackMetaLead({ content_name: "demo_request" });
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="landing-demo-title"
        className={styles.modalContent}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" aria-label="Close" className={styles.modalClose} onClick={onClose}>
          ×
        </button>
        <h2 id="landing-demo-title" className={styles.modalTitle}>
          Book a demo
        </h2>
        {status === "success" ? (
          <div role="status" className={styles.modalSuccess}>
            <div className={styles.successIcon} aria-hidden>
              ✓
            </div>
            <h3>Thanks — you&apos;re on the list!</h3>
            <p>We&apos;ll be in touch shortly to schedule your demo.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className={styles.modalSubtitle}>15 minutes. We&apos;ll show you a live agent built for your business.</p>
            {FIELDS.map((field) => (
              <div key={field.name} className={styles.formGroup}>
                <label htmlFor={`demo-${field.name}`}>{field.label}</label>
                <input
                  id={`demo-${field.name}`}
                  name={field.name}
                  type={field.type}
                  inputMode={field.inputMode}
                  autoComplete={field.autoComplete}
                  required
                  value={form[field.name]}
                  onChange={update}
                  className={styles.formInput}
                />
              </div>
            ))}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={form.website}
              onChange={update}
              className={styles.honeypot}
            />
            {status === "error" && (
              <div role="alert" className={styles.formError}>
                Something went wrong sending your request. Please try again.
              </div>
            )}
            <button
              type="submit"
              disabled={status === "submitting"}
              className={clsx(styles.btnPrimary, styles.btnLarge, styles.btnBlock, styles.modalSubmitBtn)}
            >
              {status === "submitting" ? "Sending..." : "Request my demo"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
