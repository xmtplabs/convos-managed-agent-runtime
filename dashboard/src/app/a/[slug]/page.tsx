import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSkill } from "@/lib/api";
import { ConvosLogo } from "@/components/convos-logo";
import { TemplateActions } from "./template-actions";

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
  const template = await getSkill(slug);

  if (!template) {
    return { title: "Template Not Found" };
  }

  const title = `${template.emoji} ${template.name} - Convos Assistant`;
  const description = template.description;

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
          alt: `${template.emoji} ${template.name}`,
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
// Page
// ---------------------------------------------------------------------------

export default async function TemplatePage({ params }: TemplatePageProps) {
  const { slug } = await params;
  const template = await getSkill(slug);

  if (!template) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-surface-muted flex flex-col items-center font-[Inter,sans-serif]">
      {/* Header */}
      <header className="w-full max-w-2xl px-6 pt-8 pb-4">
        <a href="/" className="inline-flex items-center gap-2 no-underline">
          <ConvosLogo width={18} height={23} />
          <span className="text-sm font-semibold text-foreground tracking-[-0.3px]">
            Convos <span className="font-normal text-foreground-secondary">Labs</span>
          </span>
        </a>
      </header>

      {/* Main content */}
      <main className="w-full max-w-2xl px-6 pb-12">
        <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-8 sm:p-10">
          {/* Emoji + Name */}
          <div className="flex items-start gap-4 mb-6">
            <span className="text-5xl leading-none" role="img" aria-label={template.name}>
              {template.emoji}
            </span>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-foreground tracking-[-0.5px] m-0">
                {template.name}
              </h1>
              <span className="inline-block mt-1.5 px-2.5 py-0.5 text-xs font-medium text-foreground-secondary bg-edge-muted rounded-full">
                {template.category}
              </span>
            </div>
          </div>

          {/* Description */}
          <p className="text-base text-foreground-secondary leading-relaxed mb-6">
            {template.description}
          </p>

          {/* Skills */}
          {template.skills.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xs font-semibold text-foreground-inverted-secondary uppercase tracking-wider mb-3">
                Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {template.skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-foreground-secondary bg-surface-muted rounded-lg border border-edge"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions (client component for interactivity) */}
          <TemplateActions
            slug={template.slug}
            notionPageId={template.notionPageId}
            agentName={template.name}
            siteUrl={process.env.NEXT_PUBLIC_SITE_URL || "https://assistants.convos.org"}
          />
        </div>
      </main>
    </div>
  );
}
