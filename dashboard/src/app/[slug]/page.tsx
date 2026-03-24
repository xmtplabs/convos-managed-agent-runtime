import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSkill } from "@/lib/api";
import { ConvosLogo } from "@/components/convos-logo";
import { SkillActions } from "./template-actions";
import "../(articles)/article.css";

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
    process.env.NEXT_PUBLIC_SITE_URL || "https://convos.org/assistants";
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

/** Convert simple markdown (headings, lists, bold, paragraphs) to HTML. */
function markdownToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Headings
    if (trimmed.startsWith("### ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h3>${applyInline(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h2>${applyInline(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h2>${applyInline(trimmed.slice(2))}</h2>`);
    }
    // List items
    else if (trimmed.startsWith("- ")) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${applyInline(trimmed.slice(2))}</li>`);
    }
    // Horizontal rule
    else if (trimmed === "---") {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push("<hr />");
    }
    // Empty line
    else if (trimmed === "") {
      if (inList) { html.push("</ul>"); inList = false; }
    }
    // Paragraph
    else {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<p>${applyInline(trimmed)}</p>`);
    }
  }

  if (inList) html.push("</ul>");
  return html.join("\n");
}

/** Apply inline formatting: **bold** */
function applyInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://convos.org/assistants";

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

        {/* Full prompt — rendered as styled prose */}
        {skill.prompt && (
          <div style={{ borderTop: "1px solid #F0F0F0", paddingTop: "24px", marginTop: "32px" }}>
            <div
              className="article"
              style={{ maxWidth: "none", padding: 0, margin: 0 }}
              dangerouslySetInnerHTML={{ __html: markdownToHtml(skill.prompt) }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
