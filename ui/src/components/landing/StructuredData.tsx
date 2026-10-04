import { CONTACT_PHONE_E164, FAQS, SEO_DESCRIPTION, SITE_URL } from "./content";

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "Sawt AI",
      url: SITE_URL,
      logo: `${SITE_URL}/sawt-logo-static.svg`,
      contactPoint: {
        "@type": "ContactPoint",
        telephone: CONTACT_PHONE_E164,
        contactType: "sales",
        availableLanguage: ["English", "Arabic", "Hebrew"],
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Sawt AI",
      publisher: { "@id": ORGANIZATION_ID },
    },
    {
      "@type": "SoftwareApplication",
      name: "Sawt AI",
      url: SITE_URL,
      description: SEO_DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      publisher: { "@id": ORGANIZATION_ID },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

/** JSON-LD for search engines: organization, product and the on-page FAQ. */
export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      // Escape "<" so the JSON can never close the script tag early.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
    />
  );
}
