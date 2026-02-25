import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { ConvosLogo } from "@/components/convos-logo";
import { getContentPage } from "@/lib/content";
import "./article.css";

const page = getContentPage("safety");

export const metadata: Metadata = {
  title: page.frontmatter.title
    ? `${page.frontmatter.title} - Convos Assistants`
    : "Convos Assistants",
  description: page.frontmatter.description,
};

export default function SafetyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>
      <article className="article">
        <a href="/" className="article-header">
          <ConvosLogo width={18} height={23} />
          <span>Convos</span>
        </a>

        <MDXRemote
          source={page.content}
          options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
        />

        <div className="article-footer">
          <span>Built by XMTP Labs</span>
          <span className="dot">&middot;</span>
          <a href="/">Back to Assistants</a>
          <span className="dot">&middot;</span>
          <a href="https://convos.org" target="_blank" rel="noopener">
            convos.org
          </a>
        </div>
      </article>
    </div>
  );
}
