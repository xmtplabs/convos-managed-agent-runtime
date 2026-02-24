# Design Implementation Plan: Prompt Store

## Summary
- **Scope:** New section added to the pool dashboard page
- **Target:** `pool/src/index.js` (inline HTML in Express template literal)
- **Winner variant:** F (synthesized from A's hierarchy + D's search/filter + B's View/Copy buttons)
- **Key features:**
  - Search bar for filtering 90+ agents
  - Category filter pills (13 categories)
  - Compact list grouped by category with uppercase headers
  - Each row: agent name, description, View button, Copy (primary) button
  - Modal overlay for viewing full prompt text
  - "Show more" pattern (first ~10 agents visible, expand for all)
  - Intro copy: "Below find our 100+ favorite group agent skills..."

## Data Source
- Agent metadata (name, description, category, skills) from Notion page `30730823ce9281909484c83e1f4704cb`
- Full prompts fetched from Notion sub-pages on demand via new API endpoint
- Extracted data available at `.claude-design/agents-data.json` (90 agents, 13 categories)

## Files to Change
- [ ] `pool/src/index.js` — Add CSS styles, HTML section, JavaScript logic, and new API endpoint

## Implementation Steps

### 1. Add Notion API integration for fetching full prompts
- Use raw `fetch()` to Notion API (no new npm deps needed)
- Env var: `NOTION_API_KEY` for Notion internal integration token
- New endpoint: `GET /api/prompts/:pageId` — fetches a Notion sub-page's text content, returns `{ name, prompt }`
- Server-side in-memory cache with ~1 hour TTL (prompts rarely change)

### 2. Embed agent catalog data in HTML
- Serialize the 90-agent catalog as a JSON `<script>` block in the HTML template
- Data per agent: `{ name, description, category, categoryEmoji, skills, status, notionPageId }`
- No extra API call needed for the initial list render

### 3. Add CSS styles to the inline stylesheet
From Variant F, add these style blocks:

**Section & header:**
- `.prompt-store` — section container with top margin/padding
- `.ps-title` — 18px, weight 700, letter-spacing -0.3px
- `.ps-intro` — 13px, color #B2B2B2, line-height 1.5

**Search:**
- `.ps-search-wrap` + `.ps-search` — border #EBEBEB, radius 10px, bg #FAFAFA
- `.ps-search-icon` — positioned left 12px, color #D4D4D4
- Focus state: border #E54D00, box-shadow rgba(229,77,0,0.06)

**Filter pills:**
- `.ps-filters` — flex wrap, gap 4px
- `.ps-filter-pill` — 11px, radius 20px, border #EBEBEB
- `.ps-filter-pill.active` — bg #000, color #fff

**Category headers:**
- `.ps-cat-header` — 10px, weight 700, uppercase, letter-spacing 0.8px, color #D4D4D4

**Agent rows:**
- `.ps-agent-row` — flex, padding 12px 0, border-bottom #F5F5F5, cursor pointer
- `.ps-agent-row:hover` — bg #FAFAFA, negative margin expansion with border-radius 8px
- `.ps-agent-name` — 14px, weight 600
- `.ps-agent-desc` — 12px, color #B2B2B2, ellipsis truncation

**Buttons:**
- `.ps-agent-actions` — flex, gap 6px
- `.ps-btn` (View) — outline, border #EBEBEB, radius 8px
- `.ps-btn.primary` (Copy) — bg #E54D00, color #fff
- `.ps-btn.copied` — bg #16A34A (green), 1.5s transition back

**Show more:**
- `.ps-show-more` — dashed border #EBEBEB, radius 10px, color #999

**Modal:**
- `.ps-modal-overlay` — fixed inset 0, bg rgba(0,0,0,0.4)
- `.ps-modal` — max-width 560px, radius 16px, shadow 0 24px 48px rgba(0,0,0,0.15)
- `.ps-modal-head` — sticky header with agent name + close button
- `.ps-modal-body` — overflow-y auto, flex: 1
- `.ps-modal-footer` — fixed footer with Copy button (bg #E54D00)

**No results:**
- `.ps-no-results` — centered, color #CCC, 13px

**Responsive:**
- At 640px: filter pills overflow-x auto, full-width buttons

### 4. Add HTML section after stories
Insert after the `.stories` closing `</div>`, still inside `#paste-view`:

```html
<div class="prompt-store" id="prompt-store">
  <div class="ps-header">
    <span class="ps-title">Try an assistant</span>
  </div>
  <p class="ps-intro">Below find our 100+ favorite group agent skills — Simply copy and paste any instructions into the chat and you now have an incredibly powerful new group agent.</p>
  <div class="ps-search-wrap">
    <span class="ps-search-icon"><svg>...</svg></span>
    <input class="ps-search" placeholder="Search assistants..." id="ps-search" />
  </div>
  <div class="ps-filters" id="ps-filters">
    <!-- Dynamically rendered from categories -->
  </div>
  <div class="ps-no-results" id="ps-no-results">No assistants match your search</div>
  <div class="ps-list" id="ps-list">
    <!-- Dynamically rendered from embedded catalog data -->
  </div>
  <button class="ps-show-more" id="ps-show-more">Show all assistants</button>
</div>

<!-- Prompt modal overlay (outside paste-view for proper stacking) -->
<div class="ps-modal-overlay" id="ps-modal">
  <div class="ps-modal">
    <div class="ps-modal-head">
      <span class="ps-modal-title" id="ps-modal-name"></span>
      <button class="ps-modal-close" id="ps-modal-close">&times;</button>
    </div>
    <div class="ps-modal-body">
      <div class="ps-modal-text" id="ps-modal-text">Loading...</div>
    </div>
    <div class="ps-modal-footer">
      <button class="ps-modal-copy" id="ps-modal-copy">Copy full prompt</button>
    </div>
  </div>
</div>
```

### 5. Add JavaScript logic

**Initialization:**
- Parse embedded catalog JSON
- Render category filter pills
- Render initial list (first 10 agents, grouped by category)
- Bind event listeners

**Search (client-side filtering):**
- On `input` event, filter agents by name + description match
- If a category filter is active, apply both filters
- Re-render visible list with matching agents
- Show/hide "No results" and "Show more" accordingly

**Category filter pills:**
- On click, toggle active state (only one active at a time, or "All")
- Re-render list filtered to that category
- If search text exists, apply both filters

**Show more / Show less:**
- Default: show first 10 agents (or all in first 2-3 categories)
- Click "Show all": render all 90 agents
- Update button text to "Show less" when expanded

**Copy prompt (fetch on demand):**
- On Copy click, check JS cache Map first
- If not cached, `fetch('/api/prompts/' + notionPageId)`
- Show "..." on button while fetching
- On success, `navigator.clipboard.writeText(promptText)`
- Flash button green "Copied!" for 1.5s
- Cache result for future clicks

**View modal:**
- On View click (or row click), open modal
- Fetch prompt from API (or cache)
- Display in scrollable modal body
- Copy button in modal footer
- Close on backdrop click, close button, or Escape key

**Prompt cache:**
- `const promptCache = new Map()` — stores fetched prompts by pageId
- Avoids re-fetching for repeat views/copies

### 6. Visibility in both modes
- Show the prompt store section in **end-user mode** (paste-view) always
- In **dev mode**, also show it below the form (useful for quick prompt copying when testing)

## Required UI States
- **Default:** First ~10 agents visible, "Show all" button
- **Searching:** Filtered list, result count, "No results" if empty
- **Loading prompt:** "..." on button or "Loading..." in modal
- **Copied:** Button flashes green for 1.5s
- **Error fetching:** "Failed to load prompt" in modal, retry option
- **All expanded:** All 90 agents visible, "Show less" button

## Accessibility Checklist
- [ ] Search input has `aria-label` or visible label
- [ ] Filter pills use `<button>` with `aria-pressed` state
- [ ] Agent rows are keyboard-focusable
- [ ] Modal traps focus when open
- [ ] Modal closes on Escape key
- [ ] Copy buttons announce state via `aria-live` region
- [ ] Color contrast meets WCAG AA (4.5:1 text, 3:1 UI)

## Design Tokens
- **Primary orange:** #E54D00
- **CTA orange:** #FC4F37
- **Success green:** #16A34A
- **Text primary:** #000
- **Text secondary:** #B2B2B2 / #999
- **Text muted:** #CCC / #D4D4D4
- **Border:** #EBEBEB
- **Background hover:** #FAFAFA
- **Search bg:** #FAFAFA
- **Active pill:** #000 bg, #fff text
- **Border radius:** 8-10px (inputs/buttons), 16px (modal), 20px (pills)
- **Font:** Inter, weights 400-700

---

*Generated by Design Lab*
