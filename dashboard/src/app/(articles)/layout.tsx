import { ConvosLogo } from "@/components/convos-logo";
import "./article.css";

export default function ArticleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-surface)" }}>
      <article className="article">
        <a href="/" className="article-header">
          <ConvosLogo width={18} height={23} />
          <span>Convos</span>
        </a>

        {children}

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
