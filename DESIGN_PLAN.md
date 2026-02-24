# Design Implementation Plan: Pool Dashboard — Joining/Success/Error States

## Summary
- **Scope:** Component (transitional states in the paste-and-go end-user view)
- **Target:** `pool/src/index.js` (inline HTML dashboard)
- **Winner:** Variant E — Full Balloon Scene
- **Key improvements:** Replace flat "Joining conversation..." text and basic green/red banners with an expressive balloon animation scene that matches the delight of the existing empty state

## Design Direction
The Convos balloon (same SVG as empty state) is the centerpiece of all three transitional states:
- **Joining:** Balloon inflates from small to full size with floating orange particles, gentle bobbing, and swaying string. Text: "Your assistant is on the way"
- **Success:** Balloon does a celebratory bounce, confetti rains down in brand colors. Text: "Your assistant has arrived!" with "Paste another link" dismiss button. Auto-fade after ~2.5s.
- **Error:** Balloon gently droops (8deg angle, 75% opacity) matching the empty state's sad energy. Text: "Couldn't reach your conversation" with "Try again" dismiss button.

## Files to Change
- [ ] `pool/src/index.js` — Add CSS for joining/success/error overlay states, add overlay HTML to the paste-view section, update the `handlePasteUrl` JS function

## Implementation Steps

### 1. Add CSS for the overlay states
Add after the existing `.empty-state` styles (around line 348):

**Overlay container:**
- `.joining-overlay` — Full area overlay with `rgba(255,255,255,0.97)` background, centered flex column
- Transitions: `opacity 0.4s ease`, starts hidden with `opacity: 0; pointer-events: none`
- `.joining-overlay.active` — `opacity: 1; pointer-events: auto`

**Balloon scene:**
- `.joining-scene` — 200×240px relative container
- `.joining-balloon-group` — Positioned at `top: 40px; left: 50%; transform: translateX(-50%)`
- Use the same balloon SVG as the empty state (72×92px)

**String segments (nested, matching empty state pattern):**
- `.joining-string-upper` wraps `.joining-string-lower` (lower nested inside upper)
- Same SVG paths as empty state strings
- Same sway animations: `string-top-sway 3.5s` and `string-btm-sway 2.8s`
- `margin: -2px auto 0; width: 20px; transform-origin: top center`

**Joining state animations:**
- Balloon inflate: `scale(0.3) → scale(1.05) → scale(1)` over 1.5s with `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Then continuous float: gentle `translateY` + slight `rotate` oscillation over 3s
- 6 floating particles (4px orange dots) with staggered `translateY` + opacity animation

**Success state animations:**
- Balloon bounce: `scale(1) → scale(1.2) translateY(-16px) → scale(0.95) → scale(1)` over 0.6s
- Enhanced drop-shadow glow
- 8 confetti pieces (mixed shapes: circles + rectangles) in brand colors (#FC4F37, #FBBF24, #34D399, #60A5FA)
- Confetti rain: `translateY(0) → translateY(300px)` with rotation, 1.5s duration
- Particles stop during success

**Error state animations:**
- Balloon droop: `scale(1) rotate(0) → scale(0.9, 0.82) rotate(8deg) translateY(10px)` over 1.2s
- Opacity settles at 0.75 (not too transparent)
- Red-tinted drop-shadow
- Particles stop during error

**Dismiss button:**
- `.joining-dismiss-btn` — 14px Inter, `padding: 10px 24px`, `border-radius: 12px`, white bg with #EBEBEB border
- Fades in with `translateY(8px) → translateY(0)` after 0.6s delay
- Error variant: red border (#FECACA) and red text (#DC2626)

**Status text:**
- `.joining-status-text` — 20px, weight 600, #333
- `.joining-status-sub` — 14px, #B2B2B2
- Success variant: text color #16A34A
- Error variant: text color #DC2626

### 2. Add overlay HTML
Add inside the `<div id="paste-view">` section, before the `.paste-input-wrap`:

```html
<div class="joining-overlay" id="joining-overlay">
  <div class="joining-scene">
    <!-- 6 floating particles -->
    <div class="joining-particle"></div> (×6, positioned with CSS)
    <!-- Balloon group -->
    <div class="joining-balloon-group">
      <svg class="joining-balloon-svg" ...><!-- same SVG as empty state, 72×92 --></svg>
      <div class="joining-string-upper">
        <svg ...><!-- same upper string SVG --></svg>
        <div class="joining-string-lower">
          <svg ...><!-- same lower string SVG --></svg>
        </div>
      </div>
    </div>
    <!-- Confetti container (8 pieces, populated by CSS) -->
    <div class="joining-confetti" id="joining-confetti">
      <div class="joining-confetti-piece"></div> (×8)
    </div>
  </div>
  <div class="joining-status-text" id="joining-text"></div>
  <div class="joining-status-sub" id="joining-sub"></div>
  <button class="joining-dismiss-btn" id="joining-dismiss" style="display:none"></button>
</div>
```

### 3. Update JavaScript
Modify the `handlePasteUrl` function to show the overlay states:

**On paste/enter (start joining):**
1. Show overlay with `.active` class and `.joining` state class
2. Set text: "Your assistant is on the way" / "Setting up a secure connection"
3. Hide dismiss button

**On success (`r.data.joined`):**
1. Remove `.joining` class, add `.success` class
2. Set text: "Your assistant has arrived!" / "They're now in your conversation"
3. Show dismiss button ("Paste another link")
4. Generate confetti particles dynamically (JS creates 20 particles with random positions/colors)
5. Auto-dismiss after 2.5s OR on button click

**On error (`.catch`):**
1. Remove `.joining` class, add `.error` class
2. Set text: "Couldn't reach your conversation" / "Check the link and try again"
3. Show dismiss button ("Try again")

**Dismiss handler:**
1. Remove `.active` class (fades out via CSS transition)
2. Reset paste input value and state
3. Re-enable paste input

### 4. Remove old success/error elements
- Remove or hide the existing `.success-banner` and `.error-message` elements for the paste-view flow (keep them for dev mode form)
- The overlay replaces both

## Required UI States
- **Idle:** Normal paste input view (unchanged)
- **Joining:** Full overlay with inflating balloon + floating particles
- **Success:** Overlay with bouncing balloon + confetti + dismiss button
- **Error:** Overlay with drooping balloon + dismiss button
- **Empty pool:** Existing empty state (unchanged — this is the inspiration)

## Accessibility Checklist
- [ ] Dismiss buttons are focusable and keyboard-operable
- [ ] Status text updates are announced (use `aria-live="polite"` on the overlay)
- [ ] Animations respect `prefers-reduced-motion` (disable animations, show static states)
- [ ] Color contrast meets WCAG AA for all status text

## Design Tokens (from existing codebase)
- Brand orange: `#E54D00` / `#FC4F37`
- Text primary: `#333`
- Text secondary: `#B2B2B2`
- Success green: `#16A34A`
- Error red: `#DC2626`
- Border: `#EBEBEB`
- Font: Inter, weight 500-700
- Border radius: 12-14px
- Confetti colors: `#FC4F37`, `#FBBF24`, `#34D399`, `#60A5FA`

---

*Generated by Design Lab*
