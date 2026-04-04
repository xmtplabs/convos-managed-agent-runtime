"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

import { ConvosLogo } from "@/components/convos-logo";
import { ShareButton } from "@/components/share-button";
import { SkillBrowser } from "@/components/skill-browser";
import type { AgentSkill } from "@/lib/types";

export default function Home() {
  const [skills, setSkills] = useState<AgentSkill[]>([]);

  useEffect(() => {
    async function loadSkills() {
      try {
        const res = await fetch(`${basePath}/api/skills`);
        if (!res.ok) return;
        const data: AgentSkill[] = await res.json();
        setSkills(data);
      } catch {}
    }
    loadSkills();
  }, []);

  const featured = skills.filter((s) => s.featured);
  const totalCount = skills.length;

  return (
    <>
      {/* Hero section */}
      <div className="hero-section">
        <div className="hero-inner">
          {/* Brand */}
          <div className="brand">
            <div className="brand-icon">
              <ConvosLogo />
            </div>
            <span className="brand-name">
              Convos <span className="brand-name-labs">Playroom</span>
            </span>
          </div>

          <h1 className="page-title">Teach your assistant anything</h1>
          <p className="page-subtitle">
            {totalCount > 0
              ? `${totalCount} skills your assistant can learn. Browse, share, or write your own.`
              : "Skills your assistant can learn. Browse, share, or write your own."}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="content-section">
        <div className="content-inner">
          {/* Featured skills */}
          {featured.length > 0 && (
            <div className="featured-section">
              <div className="section-label">Featured</div>
              <div className="featured-grid">
                {featured.map((skill) => (
                  <FeaturedCard key={skill.slug} skill={skill} />
                ))}
              </div>
            </div>
          )}

          {/* All skills browser */}
          <SkillBrowser skills={skills} />

          {/* Get Convos strip */}
          <div className="get-convos">
            <div className="get-convos-left">
              <div className="get-convos-text">
                <div className="get-convos-tagline">Get Convos</div>
                <div className="get-convos-sub">
                  Everyday private chat for the AI world
                </div>
              </div>
            </div>
            <a
              className="get-convos-btn"
              href="https://convos.org/app"
              target="_blank"
              rel="noopener"
            >
              Download
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Featured Card
// ---------------------------------------------------------------------------

function FeaturedCard({ skill }: { skill: AgentSkill }) {
  return (
    <Link href={`/${skill.slug}`} className="featured-card">
      <div className="featured-emoji">{skill.emoji}</div>
      <div className="featured-name">{skill.agentName}</div>
      <div className="featured-desc">{skill.description}</div>
      <div className="featured-footer">
        <span className="featured-category">{skill.category}</span>
        <ShareButton slug={skill.slug} size="lg" />
      </div>
    </Link>
  );
}

