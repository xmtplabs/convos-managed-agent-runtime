import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSkill } from "@/lib/api";
import { ConvosLogo } from "@/components/convos-logo";
import { SkillActions } from "./template-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplatePageProps {
  params: Promise<{ slug: string }>;
}

// ---------------------------------------------------------------------------
// Metadata (SSR OG tags)
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: TemplatePageProps): Promise<Metadata> {
  const { slug } = await params;
  const skill = await getSkill(slug);

  if (!skill) {
    return { title: "Skill Not Found" };
  }

  const title = `${skill.emoji} ${skill.agentName} - Convos Assistant`;
  const description = skill.description;

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://assistants.convos.org";
  const ogImageUrl = `${siteUrl}/og/${encodeURIComponent(slug)}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Convos Assistants",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${skill.emoji} ${skill.agentName}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SkillPage({ params }: TemplatePageProps) {
  const { slug } = await params;
  const skill = await getSkill(slug);

  if (!skill) {
    notFound();
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://assistants.convos.org";

  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif", WebkitFontSmoothing: "antialiased" }}>
      {/* Header */}
      <header style={{ width: "100%", maxWidth: "672px", margin: "0 auto", padding: "32px 24px 16px" }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
          <ConvosLogo width={18} height={23} />
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#000", letterSpacing: "-0.3px" }}>
            Convos <span style={{ fontWeight: 400, color: "#666" }}>Playroom</span>
          </span>
        </a>
      </header>

      {/* Main */}
      <main style={{ maxWidth: "672px", margin: "0 auto", padding: "0 24px 64px" }}>
        {/* Back link */}
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#B2B2B2", textDecoration: "none", marginBottom: "32px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
          All skills
        </a>

        {/* Title block */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", flexShrink: 0 }}>
              {skill.emoji}
            </div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#000", letterSpacing: "-0.5px", margin: 0 }}>
              {skill.agentName}
            </h1>
          </div>
          <p style={{ fontSize: "15px", color: "#666", lineHeight: "1.5", margin: "0 0 12px" }}>
            {skill.description}
          </p>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" as const, alignItems: "center" }}>
            <span style={{ padding: "4px 10px", fontSize: "12px", color: "#666", background: "#F5F5F5", borderRadius: "6px" }}>
              {skill.category}
            </span>
            {skill.tools.map((tool) => (
              <span key={tool} style={{ padding: "4px 10px", fontSize: "12px", color: "#999", background: "#F5F5F5", borderRadius: "6px" }}>
                {tool}
              </span>
            ))}
            {skill.updatedAt && (
              <>
                <span style={{ color: "#D9D9D9", margin: "0 2px" }}>·</span>
                <span style={{ fontSize: "12px", color: "#B2B2B2" }}>
                  Updated {formatDate(skill.updatedAt)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Actions (client component) */}
        <SkillActions
          slug={skill.slug}
          prompt={skill.prompt}
          agentName={skill.agentName}
          siteUrl={siteUrl}
        />

        {/* Full prompt */}
        {skill.prompt && (
          <div style={{ borderTop: "1px solid #F0F0F0", paddingTop: "24px", marginTop: "32px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#000", margin: 0 }}>Full skill prompt</h2>
            </div>
            <div style={{
              fontSize: "13px",
              color: "#333",
              lineHeight: "1.8",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "'SF Mono', 'Menlo', 'Monaco', monospace",
              background: "#FAFAFA",
              border: "1px solid #F0F0F0",
              borderRadius: "10px",
              padding: "24px",
            }}>
              {skill.prompt}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
