"use client";

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
  useEffect,
} from "react";
import type { AgentSkill } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PS_LIMIT = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillBrowserProps {
  skills: AgentSkill[];
  onOpenModal: (prompt: string, name: string) => void;
  activeStep: number;
  setActiveStep: (step: number) => void;
}

interface CategoryInfo {
  name: string;
  emoji: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SkillBrowser = forwardRef<HTMLDivElement, SkillBrowserProps>(
  function SkillBrowser({ skills, onOpenModal, activeStep, setActiveStep }, ref) {
    const [category, setCategory] = useState("All");
    const [search, setSearch] = useState("");
    const [expanded, setExpanded] = useState(false);

    // Track per-button copy state by skill id
    const [copyStates, setCopyStates] = useState<
      Record<string, "idle" | "copied" | "error">
    >({});
    const copyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    // Clear all copy timers on unmount
    useEffect(() => {
      return () => {
        for (const id of Object.values(copyTimers.current)) {
          clearTimeout(id);
        }
      };
    }, []);

    // Inner div ref for forwarding
    const innerRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);

    // ------------------------------------------------------------------
    // Derived data
    // ------------------------------------------------------------------

    // Unique categories in insertion order
    const categories = useMemo<CategoryInfo[]>(() => {
      const seen = new Set<string>();
      const result: CategoryInfo[] = [];
      for (const skill of skills) {
        if (skill.category && !seen.has(skill.category)) {
          seen.add(skill.category);
          result.push({ name: skill.category, emoji: skill.emoji });
        }
      }
      return result;
    }, [skills]);

    // Filtered list
    const filteredList = useMemo(() => {
      const q = search.toLowerCase();
      return skills.filter((a) => {
        if (category !== "All" && a.category !== category) return false;
        if (
          q &&
          a.agentName.toLowerCase().indexOf(q) === -1 &&
          a.description.toLowerCase().indexOf(q) === -1
        )
          return false;
        return true;
      });
    }, [skills, category, search]);

    // Shown list (limited to PS_LIMIT unless expanded/filtering/searching)
    const shownList = useMemo(() => {
      if (search || category !== "All" || expanded) return filteredList;
      return filteredList.slice(0, PS_LIMIT);
    }, [filteredList, search, category, expanded]);

    // Show more button
    const showMoreVisible = useMemo(() => {
      if (search || category !== "All") return false;
      if (!expanded && filteredList.length > PS_LIMIT) return true;
      if (expanded) return true;
      return false;
    }, [search, category, expanded, filteredList.length]);

    const showMoreText = useMemo(() => {
      if (!expanded && filteredList.length > PS_LIMIT) {
        return `Show all ${filteredList.length} assistants`;
      }
      return "Show less";
    }, [expanded, filteredList.length]);

    const noResults = shownList.length === 0;

    // ------------------------------------------------------------------
    // Handlers
    // ------------------------------------------------------------------

    const handleSearchChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value.trim());
      },
      [],
    );

    const handleFilterClick = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        const pill = (e.target as HTMLElement).closest(
          ".ps-filter-pill",
        ) as HTMLButtonElement | null;
        if (!pill) return;
        setCategory(pill.dataset.cat || "All");
      },
      [],
    );

    const handleShowMore = useCallback(() => {
      setExpanded((prev) => !prev);
    }, []);

    const handleCopy = useCallback(
      async (skillId: string, prompt: string, e: React.MouseEvent) => {
        e.stopPropagation();

        try {
          await navigator.clipboard.writeText(prompt);
          setCopyStates((prev) => ({ ...prev, [skillId]: "copied" }));

          // Advance step 2 -> 3
          if (activeStep === 2) {
            setActiveStep(3);
          }

          if (copyTimers.current[skillId])
            clearTimeout(copyTimers.current[skillId]);
          copyTimers.current[skillId] = setTimeout(() => {
            setCopyStates((prev) => ({ ...prev, [skillId]: "idle" }));
          }, 1500);
        } catch {
          setCopyStates((prev) => ({ ...prev, [skillId]: "error" }));
          if (copyTimers.current[skillId])
            clearTimeout(copyTimers.current[skillId]);
          copyTimers.current[skillId] = setTimeout(() => {
            setCopyStates((prev) => ({ ...prev, [skillId]: "idle" }));
          }, 1500);
        }
      },
      [activeStep, setActiveStep],
    );

    const handleView = useCallback(
      (prompt: string, name: string, e: React.MouseEvent) => {
        e.stopPropagation();
        onOpenModal(prompt, name);
      },
      [onOpenModal],
    );

    const handleRowClick = useCallback(
      (prompt: string, name: string) => {
        if (prompt) {
          onOpenModal(prompt, name);
        }
      },
      [onOpenModal],
    );

    // ------------------------------------------------------------------
    // Render helpers
    // ------------------------------------------------------------------

    function getCopyButtonText(skillId: string): string {
      const state = copyStates[skillId] || "idle";
      if (state === "copied") return "Copied!";
      if (state === "error") return "Error";
      return "Copy";
    }

    function getCopyButtonClass(skillId: string): string {
      const state = copyStates[skillId] || "idle";
      let cls = "ps-btn primary ps-copy-btn";
      if (state === "copied") cls += " copied";
      return cls;
    }

    // Build the list with category headers interspersed
    const listElements: React.ReactNode[] = [];
    let lastCat = "";
    for (const agent of shownList) {
      if (agent.category !== lastCat) {
        lastCat = agent.category;
        listElements.push(
          <div key={`cat-${agent.category}`} className="ps-cat-header">
            {agent.emoji} {agent.category}
          </div>,
        );
      }
      listElements.push(
        <div
          key={agent.id}
          className="ps-agent-row"
          data-name={agent.agentName}
          onClick={() => handleRowClick(agent.prompt, agent.agentName)}
        >
          <div className="ps-agent-info">
            <div className="ps-agent-name">{agent.agentName}</div>
            <div className="ps-agent-desc">{agent.description}</div>
          </div>
          <div className="ps-agent-actions">
            {agent.prompt && (
              <>
                <button
                  className="ps-btn ps-view-btn"
                  onClick={(e) =>
                    handleView(agent.prompt, agent.agentName, e)
                  }
                >
                  View
                </button>
                <button
                  className={getCopyButtonClass(agent.id)}
                  onClick={(e) => handleCopy(agent.id, agent.prompt, e)}
                >
                  {getCopyButtonText(agent.id)}
                </button>
              </>
            )}
          </div>
        </div>,
      );
    }

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------

    if (!skills.length) return null;

    return (
      <div className="prompt-store" id="prompt-store" ref={innerRef}>
        <div className="ps-header">
          <span className="ps-title">Try out assistant skills</span>
        </div>
        <p className="ps-intro">
          Copy any of our {skills.length} favorite skills into the chat, tweak
          it however you want, or write your own from scratch. Go crazy, try
          anything &mdash; if it doesn&rsquo;t work, just tell it to forget and
          start over.
        </p>
        <div className="ps-search-wrap">
          <span className="ps-search-icon">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            className="ps-search"
            placeholder="Search assistants..."
            id="ps-search"
            aria-label="Search assistants"
            onChange={handleSearchChange}
          />
        </div>
        <div
          className="ps-filters"
          id="ps-filters"
          onClick={handleFilterClick}
        >
          <button
            className={`ps-filter-pill${category === "All" ? " active" : ""}`}
            data-cat="All"
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              className={`ps-filter-pill${category === c.name ? " active" : ""}`}
              data-cat={c.name}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
        <div
          className="ps-no-results"
          id="ps-no-results"
          style={{ display: noResults ? "block" : "none" }}
        >
          No assistants match your search
        </div>
        <div className="ps-list" id="ps-list">
          {listElements}
        </div>
        <button
          className="ps-show-more"
          id="ps-show-more"
          style={{ display: showMoreVisible ? "block" : "none" }}
          onClick={handleShowMore}
        >
          {showMoreText}
        </button>
      </div>
    );
  },
);
