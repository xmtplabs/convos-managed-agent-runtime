"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { AgentSkill } from "@/lib/types";
import { ShareButton } from "@/app/page";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillBrowserProps {
  skills: AgentSkill[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillBrowser({ skills }: SkillBrowserProps) {
  const [search, setSearch] = useState("");

  // Group skills by category
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = skills.filter((s) => {
      if (!q) return true;
      return (
        s.agentName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });

    const groups: { category: string; emoji: string; skills: AgentSkill[] }[] = [];
    const catMap = new Map<string, AgentSkill[]>();

    for (const s of filtered) {
      if (!catMap.has(s.category)) catMap.set(s.category, []);
      catMap.get(s.category)!.push(s);
    }

    for (const [cat, catSkills] of catMap) {
      groups.push({ category: cat, emoji: catSkills[0].emoji, skills: catSkills });
    }

    return groups;
  }, [skills, search]);

  if (!skills.length) return null;

  return (
    <div className="skill-browser">
      {/* Search */}
      <div className="ps-search-wrap">
        <span className="ps-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </span>
        <input
          className="ps-search"
          placeholder="Search skills..."
          aria-label="Search skills"
          onChange={(e) => setSearch(e.target.value.trim())}
        />
      </div>

      {/* Category groups */}
      {grouped.map((group) => (
        <div key={group.category} className="skill-group">
          <div className="skill-group-header">
            <span className="skill-group-emoji">{group.emoji}</span>
            <h2 className="skill-group-name">{group.category}</h2>
            <span className="skill-group-count">{group.skills.length}</span>
          </div>

          <div className="skill-group-list">
            {group.skills.map((skill) => (
              <div key={skill.slug} className="skill-row">
                <div className="skill-row-info">
                  <Link href={`/${skill.slug}`} className="skill-row-name">
                    {skill.agentName}
                  </Link>
                  <div className="skill-row-desc">{skill.description}</div>
                  {skill.tools.length > 0 && (
                    <div className="skill-row-tools">
                      {skill.tools.map((t) => (
                        <span key={t} className="skill-tool-badge">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="skill-row-actions">
                  <Link href={`/${skill.slug}`} className="skill-details-btn">
                    Details
                  </Link>
                  <ShareButton slug={skill.slug} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {grouped.length === 0 && (
        <div className="ps-no-results" style={{ display: "block" }}>
          No skills match your search
        </div>
      )}
    </div>
  );
}
