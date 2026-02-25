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

  // NOTE: OG images will be added by Task 9 (/og/[slug] route).
  // Until then, social previews use title + description only (no image).
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Convos Assistants",
    },
    twitter: {
      card: "summary",
      title,
      description,
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
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col items-center font-[Inter,sans-serif]">
      {/* Header */}
      <header className="w-full max-w-2xl px-6 pt-8 pb-4">
        <a href="/" className="inline-flex items-center gap-2 no-underline">
          <ConvosLogo width={18} height={23} />
          <span className="text-sm font-semibold text-[#333] tracking-[-0.3px]">
            Convos
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
              <h1 className="text-2xl font-bold text-[#111] tracking-[-0.5px] m-0">
                {template.name}
              </h1>
              <span className="inline-block mt-1.5 px-2.5 py-0.5 text-xs font-medium text-[#666] bg-[#f0f0f0] rounded-full">
                {template.category}
              </span>
            </div>
          </div>

          {/* Description */}
          <p className="text-base text-[#444] leading-relaxed mb-6">
            {template.description}
          </p>

          {/* Skills */}
          {template.skills.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-3">
                Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {template.skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-[#555] bg-[#f5f5f5] rounded-lg border border-[#e5e5e5]"
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
          />
        </div>
      </main>
    </div>
  );
}
