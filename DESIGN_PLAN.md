# Design Implementation Plan: Joining Overlay Fix

## Summary
- **Scope:** Component redesign
- **Target:** `pool/src/index.js` (inline HTML/CSS/JS in Express template)
- **Winner variant:** C — Scroll to Skills
- **Key improvements:**
  - Fix overlay centering on large viewports (center in content area, not full page)
  - Replace "Paste another link" success CTA with auto-scroll to skills + toast
  - Highlight step 2 after successful join
  - Pulse skill cards to draw attention

## Files to Change
- [ ] `pool/src/index.js` — CSS changes, new HTML elements, JS logic updates

## Implementation Steps

### 1. Fix overlay centering (CSS)

Change `.joining-overlay` from `inset: 0` to constrained height:

```css
/* BEFORE */
.joining-overlay {
  position: absolute;
  inset: 0;
  justify-content: center;
}

/* AFTER */
.joining-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 380px;        /* Cover just the content area */
  justify-content: center;
  border-radius: 0 0 14px 14px;
}
```

This constrains the overlay to the title + paste input region instead of the full `.form-center` container (which includes stories, skills, etc.).

### 2. Add success toast element (HTML)

Add a toast element inside `#paste-view`, before the `.joining-overlay`:

```html
<div class="success-toast" id="success-toast">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9 12l2 2 4-4"/>
  </svg>
  Assistant joined!
</div>
```

### 3. Add new CSS styles

**Success toast:**
```css
.success-toast {
  display: none;
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #16A34A;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  padding: 10px 20px;
  border-radius: 20px;
  z-index: 15;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(22,163,74,0.25);
  align-items: center;
  gap: 8px;
}
.success-toast.visible {
  display: flex;
  animation: toast-in 0.3s ease-out;
}
@keyframes toast-in {
  0% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  100% { opacity: 1; transform: translateX(-50%) translateY(0); }
}
```

**Step 2 highlight:**
```css
.step.highlight .step-num {
  background: #E54D00;
  color: #fff;
}
.step.highlight {
  color: #333;
  font-weight: 500;
}
```

**Skill card pulse:**
```css
.ps-card.pulsing {
  animation: skill-pulse 1.5s ease-in-out 3;
}
@keyframes skill-pulse {
  0%, 100% { border-color: #EBEBEB; box-shadow: none; }
  50% { border-color: #E54D00; box-shadow: 0 0 0 3px rgba(229,77,0,0.1); }
}
```

**Skills section highlight flash:**
```css
.prompt-store.highlighted {
  animation: skills-highlight 2s ease-out;
}
@keyframes skills-highlight {
  0% { background: rgba(229, 77, 0, 0.08); }
  100% { background: transparent; }
}
```

**Reduced motion additions:**
```css
@media (prefers-reduced-motion: reduce) {
  .success-toast { animation: none; }
  .ps-card.pulsing { animation: none; border-color: #E54D00; }
  .prompt-store.highlighted { animation: none; }
}
```

### 4. Update JavaScript `showJoiningOverlay` success flow

Replace the current success behavior:

```javascript
// BEFORE (current):
if(state==='success'){
  // confetti...
  joiningAutoHideTimer=setTimeout(function(){hideJoiningOverlay();},2500);
}

// AFTER:
if(state==='success'){
  // confetti (keep existing)...
  joiningAutoHideTimer=setTimeout(function(){
    // 1. Hide overlay
    hideJoiningOverlay();
    // 2. Show toast
    var toast = document.getElementById('success-toast');
    toast.classList.add('visible');
    // 3. Highlight step 2
    var steps = document.querySelectorAll('.step');
    if(steps[1]) steps[1].classList.add('highlight');
    // 4. Scroll to skills section
    setTimeout(function(){
      var ps = document.getElementById('prompt-store');
      if(ps) {
        ps.scrollIntoView({ behavior: 'smooth', block: 'start' });
        ps.classList.add('highlighted');
        // 5. Pulse skill cards
        ps.querySelectorAll('.ps-card').forEach(function(c){ c.classList.add('pulsing'); });
      }
    }, 300);
    // 6. Hide toast after 3s
    setTimeout(function(){
      toast.classList.remove('visible');
    }, 3000);
    // 7. Clean up pulses after animation
    setTimeout(function(){
      document.querySelectorAll('.ps-card.pulsing').forEach(function(c){ c.classList.remove('pulsing'); });
    }, 5000);
  }, 1500); // Show confetti for 1.5s before transitioning
}
```

### 5. Update dismiss button behavior

Remove the "Paste another link" text for success state. The dismiss button is no longer needed on success since the overlay auto-dismisses. Keep "Try again" for error state only:

```javascript
// BEFORE:
joiningDismiss.style.display=(state==='success'||state==='error')?'':'none';
joiningDismiss.textContent=state==='success'?'Paste another link':'Try again';

// AFTER:
joiningDismiss.style.display=(state==='error')?'':'none';
joiningDismiss.textContent='Try again';
```

## Required UI States
- **Joining:** Balloon inflate + float (unchanged)
- **Success:** Confetti (1.5s) → overlay dismisses → toast appears → scroll to skills → cards pulse
- **Error:** Balloon droop + "Try again" button (unchanged)
- **Toast:** Green pill, auto-hides after 3s
- **Step highlight:** Step 2 number turns orange, text bolds
- **Card pulse:** Orange border pulse, 3 cycles

## Accessibility Checklist
- [ ] Toast uses `aria-live="polite"` for screen reader announcement
- [ ] Step highlight is visible (not color-only — also bold weight)
- [ ] Card pulse respects `prefers-reduced-motion`
- [ ] `scroll-behavior: smooth` degrades gracefully
- [ ] Toast has sufficient contrast (white on green #16A34A = 4.6:1)

## Design Tokens (existing, no new ones)
- **Success green:** #16A34A
- **Primary orange:** #E54D00
- **Border:** #EBEBEB
- **Text primary:** #333
- **Border radius:** 14px (overlay), 20px (toast)

---

*Generated by Design Lab*
