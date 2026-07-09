# Quote "Read More" Truncation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clamp quote card text to 11 lines and add a "Read more" button that opens a popup with the full quote, so long quotes stop breaking the Quotes tab's masonry grid symmetry — shipped identically in both `moodboard-multi-user` (this repo) and the sibling `moodboard` repo at `/Users/deepinder/Desktop/Claude/Personal-projects/moodboard`.

**Architecture:** CSS `-webkit-line-clamp: 11` on the quote text, applied unconditionally. A `ResizeObserver` in `QuoteCard` compares `scrollHeight`/`clientHeight` on the clamped element to detect real overflow (robust across the masonry grid's 2/3/4-column breakpoints), and only then shows a "Read more" button. Clicking it opens a new `QuoteReadMoreModal`, reusing the existing `.modal-overlay`/`.modal-drawer` bottom-sheet pattern already used by `ChangePasswordModal`.

**Tech Stack:** React + Vite, plain CSS (no new dependencies — `ResizeObserver` is a browser-native API).

## Global Constraints

- Scope is `QuoteCard`'s quote text only — no changes to Discover cards, the note editor, or the author/subtitle line.
- Reuse the existing `.modal-overlay`/`.modal-drawer`/`.modal-handle`/`.modal-label`/`.modal-actions`/`.modal-btn-secondary` CSS classes exactly as `ChangePasswordModal` does — no new modal chrome.
- No test infra exists for `QuoteCard` or page-level components in either repo (confirmed during the prior pin/favourite feature) — verification is typecheck plus manual browser check, not automated tests.
- The `moodboard` repo (Task 2) has no test infra at all — verify with `pnpm run typecheck` and `pnpm run build` only, same as the prior feature's sibling-repo port task.

---

### Task 1: Quote read-more modal + truncation wiring (moodboard-multi-user)

**Files:**
- Create: `artifacts/moodboard/src/components/QuoteReadMoreModal.tsx`
- Modify: `artifacts/moodboard/src/components/QuoteCard.tsx` (full-file replace — many small interleaved changes)
- Modify: `artifacts/moodboard/src/index.css` (two insertions: modal-quote styles, quote-card-text clamp/button styles)

**Interfaces:**
- Produces: `QuoteReadMoreModal({ text: string, author?: string, onClose: () => void })` — a self-contained modal component, not wired through any page; `QuoteCard` renders it directly from its own local state, no prop changes needed on `QuoteCardProps`.

- [ ] **Step 1: Create `QuoteReadMoreModal.tsx`**

```tsx
import { useRef } from "react";

interface QuoteReadMoreModalProps {
  text: string;
  author?: string;
  onClose: () => void;
}

export function QuoteReadMoreModal({ text, author, onClose }: QuoteReadMoreModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="modal-drawer">
        <div className="modal-handle" />
        <p className="modal-label">Quote</p>

        <p className="modal-quote-text">{text}</p>
        {author && <p className="modal-quote-author">{author}</p>}

        <div className="modal-actions">
          <button type="button" className="modal-btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `QuoteCard.tsx` in full**

```tsx
import { useEffect, useRef, useState } from "react";
import type { MoodboardItem } from "@/types";
import { QuoteReadMoreModal } from "./QuoteReadMoreModal";

interface QuoteCardProps {
  item: MoodboardItem;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onTogglePin: (id: string) => void;
  isHighlighted?: boolean;
}

function EditIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.5l2 3.5H7l2-3.5z" />
    </svg>
  );
}

export function QuoteCard({ item, onRemove, onEdit, onTogglePin, isHighlighted }: QuoteCardProps) {
  const meta: Record<string, string> = (() => {
    try { return item.meta ? JSON.parse(item.meta) : {}; }
    catch { return {}; }
  })();

  const color = meta.color ?? "sage";
  const pinned = !!item.pinned;

  const [isOverflowing, setIsOverflowing] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const checkOverflow = () => {
      setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(item.id);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(item.id);
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(item.id);
  };

  const handleReadMore = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFull(true);
  };

  return (
    <div
      className={`quote-card quote-card--${color}`}
      data-item-id={item.id}
      data-highlight={isHighlighted ? "true" : undefined}
    >
      <p ref={textRef} className="quote-card-text quote-card-text--clamped">{item.title}</p>
      {isOverflowing && (
        <button className="quote-read-more-btn" onClick={handleReadMore}>
          Read more
        </button>
      )}
      {item.subtitle && <p className="quote-card-author">{item.subtitle}</p>}

      <button className="discover-edit-btn" onClick={handleEdit} aria-label="Edit quote">
        <EditIcon />
      </button>

      <button
        className={`card-pin ${pinned ? "card-pin--active" : ""}`}
        onClick={handlePin}
        aria-label={pinned ? "Unpin quote" : "Pin quote"}
      >
        <PinIcon />
      </button>

      <button className="card-remove" onClick={handleRemove} aria-label="Remove quote">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      {showFull && (
        <QuoteReadMoreModal
          text={item.title ?? ""}
          author={item.subtitle}
          onClose={() => setShowFull(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add CSS for the modal's quote text/author**

In `artifacts/moodboard/src/index.css`, right after this existing block (ends around line 1068):

```css
.modal-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

insert:

```css

.modal-quote-text {
  font-family: 'Libre Baskerville', Georgia, serif;
  font-style: italic;
  font-size: var(--text-lg);
  line-height: 1.6;
  letter-spacing: 0.01em;
  color: var(--quote-text);
  max-height: 60vh;
  overflow-y: auto;
  word-break: break-word;
  margin-bottom: var(--space-4);
}

.modal-quote-author {
  font-family: 'DM Sans', sans-serif;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--quote-text);
  opacity: 0.6;
  letter-spacing: 0.01em;
}
```

- [ ] **Step 4: Add CSS for the clamp and the "Read more" button**

In the same file, right after this existing block (the `QUOTE CARD` section's first rule):

```css
.quote-card-text {
  font-family: 'Libre Baskerville', Georgia, serif;
  font-style: italic;
  font-size: var(--text-lg);
  line-height: 1.6;
  letter-spacing: 0.01em;
  color: var(--quote-text);
  margin-bottom: var(--space-4);
  word-break: break-word;
}
```

insert (before `.quote-card-author`):

```css

.quote-card-text--clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 11;
  line-clamp: 11;
  overflow: hidden;
}

.quote-read-more-btn {
  display: block;
  margin: -8px 0 var(--space-4);
  padding: 0;
  background: none;
  border: none;
  font-family: 'DM Sans', sans-serif;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--quote-text);
  opacity: 0.7;
  text-decoration: underline;
  cursor: pointer;
}

.quote-read-more-btn:hover {
  opacity: 1;
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/moodboard typecheck`
Expected: no errors.

- [ ] **Step 6: Run the existing frontend test suite**

Run: `pnpm --filter @workspace/moodboard test`
Expected: PASS (no new tests added per the plan's Global Constraints — this confirms nothing broke).

- [ ] **Step 7: Manual browser verification**

Start the dev servers for this repo (backend `pnpm --filter @workspace/api-server dev`, frontend `pnpm --filter @workspace/moodboard dev`, or however this repo's `dev` workflow normally runs), log in, go to the Quotes tab:
- Add (or find) a quote long enough to exceed 11 lines at the current column width. Confirm the card shows clamped text and a "Read more" button.
- Click "Read more" — confirm a bottom-sheet drawer opens showing the full quote text and author, scrollable if very long.
- Click "Close" (and separately, click the dark overlay outside the drawer) — confirm both close the modal.
- Confirm a short quote (well under 11 lines) shows no "Read more" button and looks unchanged.

- [ ] **Step 8: Commit**

```bash
git add artifacts/moodboard/src/components/QuoteReadMoreModal.tsx artifacts/moodboard/src/components/QuoteCard.tsx artifacts/moodboard/src/index.css
git commit -m "feat(moodboard): clamp long quotes to 11 lines with a Read more popup"
```

---

### Task 2: Port the same change to the sibling `moodboard` repo

`QuoteCard.tsx` and `index.css` in the sibling repo (`/Users/deepinder/Desktop/Claude/Personal-projects/moodboard`) are byte-identical to this repo's pre-Task-1 state (same convention verified during the prior pin/favourite feature's port). This repo has **no test infrastructure** — verify with `typecheck` and `build` only.

Work happens in a new branch, not a worktree (this repo isn't managed by this session's worktree tooling):

```bash
cd /Users/deepinder/Desktop/Claude/Personal-projects/moodboard
git checkout -b quote-read-more
```

**Files (all in `/Users/deepinder/Desktop/Claude/Personal-projects/moodboard`):**
- Create: `artifacts/moodboard/src/components/QuoteReadMoreModal.tsx`
- Modify: `artifacts/moodboard/src/components/QuoteCard.tsx`
- Modify: `artifacts/moodboard/src/index.css`

- [ ] **Step 1:** Create `QuoteReadMoreModal.tsx` with the exact same contents as Task 1 Step 1.

- [ ] **Step 2:** Replace `QuoteCard.tsx` with the exact same full-file contents as Task 1 Step 2.

- [ ] **Step 3:** Apply the exact same two CSS insertions as Task 1 Steps 3 and 4, at the same anchor points (`.modal-btn-primary:disabled { ... }` block, and `.quote-card-text { ... }` block).

- [ ] **Step 4: Typecheck and build**

Run: `pnpm run typecheck`
Expected: no errors.

Run: `pnpm run build`
Expected: succeeds. (If the frontend `vite build` step hits the same pre-existing darwin-arm64 native-binary lockfile exclusion documented in the prior pin/favourite port, that is a known environment limitation unrelated to this change — a clean `tsc --noEmit` pass is sufficient confirmation the code itself is correct, same as last time.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: clamp long quotes to 11 lines with a Read more popup"
```

- [ ] **Step 6: Merge to main and push**

```bash
git checkout main
git merge --ff-only quote-read-more
git push origin main
git branch -d quote-read-more
```

---

### Task 3: Final whole-branch review and ship (moodboard-multi-user)

- [ ] **Step 1: Run the full frontend suite and typecheck**

Run: `pnpm --filter @workspace/moodboard test`
Run: `pnpm run typecheck`
Expected: all green.

- [ ] **Step 2: Merge this feature's commit to local `main` and push**

Follow this repo's established pattern (pin/favourite, change-password, multi-account) — fast-forward merge to local `main`, no PR, push to `origin/main`.
