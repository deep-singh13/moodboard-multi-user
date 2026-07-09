# Pin/Favourite + Newest-First Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show newest items first (not last) in the Discover and Quotes tabs, and let users pin/favourite specific items so they stay above everything else — shipped identically in both `moodboard-multi-user` (this repo) and `moodboard` (the sibling single-user repo at `/Users/deepinder/Desktop/Claude/Personal-projects/moodboard`).

**Architecture:** Add a `pinned BOOLEAN NOT NULL DEFAULT false` column to `items`. Change `GET /items` to `ORDER BY pinned DESC, added_at DESC`. `PATCH /items/:id` gains a `pinned` branch identical in shape to the existing `completed` branch. Frontend mirrors the sort locally (via a small `sortItems` helper) so optimistic updates — adding an item, toggling a pin — reorder the UI immediately instead of waiting for the next full reload.

**Tech Stack:** Express 5 + `pg` (backend), React + Vite (frontend), vitest/supertest for backend tests, vitest for frontend unit tests (multi-user repo only — the single-user `moodboard` repo has no test infra, so its port task is verified by typecheck + build only).

## Global Constraints

- Scope is the Discover and Quotes tabs only — the main moodboard canvas (freeform-positioned board) is untouched.
- The `moodboard-multi-user` repo's `user_id` scoping must stay on every items query touched here; the `moodboard` repo has no such scoping (single-user) and must not gain any.
- Match existing code patterns exactly: the `pinned` column/branch mirrors the existing `completed` column/branch everywhere (DB, route, `rowToItem`, API client, page callback, card button).
- No new abstractions: reuse existing CSS class patterns (`.card-check--done` → `.card-pin--active`) and existing SVG icon style (`stroke="currentColor" strokeWidth="2.5"`, 11×11 viewBox 24).

---

### Task 1: Backend — `pinned` column, ordering, and PATCH branch (moodboard-multi-user)

**Files:**
- Modify: `artifacts/api-server/src/lib/db.ts:66-71` (append new `ALTER TABLE` + keep existing statements)
- Modify: `artifacts/api-server/src/routes/items.ts` (`rowToItem` at lines 9-27, `GET /items` at lines 29-40, `PATCH /items/:id` at lines 93-158)
- Test: `artifacts/api-server/src/routes/items.test.ts`

**Interfaces:**
- Produces: `items.pinned` column (boolean, default false); `rowToItem()` output includes `pinned: boolean`; `PATCH /api/items/:id` accepts `{ pinned: boolean }` in its body, scoped by `user_id` like every other branch in that handler.

- [ ] **Step 1: Write the failing test**

Add to the end of `artifacts/api-server/src/routes/items.test.ts` (after the existing `describe("PATCH /api/items/:id", ...)` block, still inside the file, as a new top-level `describe`):

```ts
describe("pinned items", () => {
  it("sorts newest-first, floats pinned items to the top, and falls back to age order when unpinned", async () => {
    const alice = await signupAgent(`alice4${TEST_EMAIL_DOMAIN}`);

    await alice.post("/api/items").send({
      id: "item-order-1",
      type: "link",
      addedAt: new Date(Date.now() - 2000).toISOString(),
      board: "moodboard",
    });
    await alice.post("/api/items").send({
      id: "item-order-2",
      type: "link",
      addedAt: new Date(Date.now() - 1000).toISOString(),
      board: "moodboard",
    });

    let items = await alice.get("/api/items");
    expect(items.body.map((i: { id: string }) => i.id)).toEqual([
      "item-order-2",
      "item-order-1",
    ]);

    await alice.patch("/api/items/item-order-1").send({ pinned: true });

    items = await alice.get("/api/items");
    expect(items.body.map((i: { id: string }) => i.id)).toEqual([
      "item-order-1",
      "item-order-2",
    ]);
    expect(items.body[0].pinned).toBe(true);

    await alice.patch("/api/items/item-order-1").send({ pinned: false });

    items = await alice.get("/api/items");
    expect(items.body.map((i: { id: string }) => i.id)).toEqual([
      "item-order-2",
      "item-order-1",
    ]);
    expect(items.body[0].pinned).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/api-server test`
Expected: FAIL — items come back in the old `added_at ASC` order (`item-order-1` before `item-order-2` in the first assertion), and `pinned` is `undefined` in the response body.

- [ ] **Step 3: Implement the DB column**

In `artifacts/api-server/src/lib/db.ts`, immediately after the existing block:

```ts
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_items_user_id ON items (user_id)
  `);
```

add:

```ts
  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false
  `);
```

- [ ] **Step 4: Implement the route changes**

In `artifacts/api-server/src/routes/items.ts`, update `rowToItem` to include `pinned`:

```ts
function rowToItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    type: row.type,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
    subtitle: row.subtitle ?? undefined,
    imageUrl:
      (row.image_url as string | null) ??
      (row.image_data as string | null) ??
      undefined,
    size: row.size ? Number(row.size) : undefined,
    addedAt: row.added_at,
    completed: row.completed ?? false,
    pinned: row.pinned ?? false,
    note: (row.note as string | null) ?? undefined,
    board: (row.board as string | null) ?? "moodboard",
    meta: (row.meta as string | null) ?? undefined,
  };
}
```

Change the `GET /items` query:

```ts
router.get("/items", async (req, res) => {
  const board = (req.query.board as string | undefined) ?? "moodboard";
  try {
    const result = await pool.query(
      "SELECT * FROM items WHERE user_id = $1 AND board = $2 ORDER BY pinned DESC, added_at DESC",
      [req.user!.id, board],
    );
    res.json(result.rows.map(rowToItem));
  } catch {
    res.status(500).json({ error: "Failed to fetch items" });
  }
});
```

Add a `pinned` branch to `PATCH /items/:id`, in the `body` type and right after the existing `completed` branch:

```ts
router.patch("/items/:id", async (req, res) => {
  const body = req.body as {
    completed?: boolean;
    pinned?: boolean;
    note?: string | null;
    title?: string | null;
    imageUrl?: string | null;
    subtitle?: string | null;
    meta?: string | null;
  };
  const userId = req.user!.id;
  try {
    if (body.completed !== undefined) {
      await pool.query("UPDATE items SET completed = $1 WHERE id = $2 AND user_id = $3", [
        body.completed,
        req.params.id,
        userId,
      ]);
    }
    if (body.pinned !== undefined) {
      await pool.query("UPDATE items SET pinned = $1 WHERE id = $2 AND user_id = $3", [
        body.pinned,
        req.params.id,
        userId,
      ]);
    }
    if ("note" in body) {
```

(everything after `if ("note" in body) {` is unchanged).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (all tests, including the new `pinned items` test).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/db.ts artifacts/api-server/src/routes/items.ts artifacts/api-server/src/routes/items.test.ts
git commit -m "feat(api-server): add pinned items and newest-first ordering"
```

---

### Task 2: Frontend API client — `patchItemPinned` (moodboard-multi-user)

**Files:**
- Modify: `artifacts/moodboard/src/types/index.ts:1-16`
- Modify: `artifacts/moodboard/src/lib/api.ts` (after `patchItemComplete`, lines 42-56)
- Test: `artifacts/moodboard/src/lib/api.test.ts`

**Interfaces:**
- Consumes: nothing new (same `fetch`/`credentials`/`notifyUnauthenticated` pattern already in `api.ts`).
- Produces: `MoodboardItem.pinned?: boolean`; `patchItemPinned(id: string, pinned: boolean): Promise<void>` in `lib/api.ts`.

- [ ] **Step 1: Write the failing test**

Add to `artifacts/moodboard/src/lib/api.test.ts`, right after the existing `it("patchItemComplete sends credentials: include", ...)` test:

```ts
  it("patchItemPinned sends credentials: include", async () => {
    mockFetchOnce({ ok: true });
    await patchItemPinned("1", true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/items/1",
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });
```

Update the import at the top of the file to include `patchItemPinned`:

```ts
import { fetchItems, createItem, deleteItem, patchItemComplete, patchItemPinned } from "./api";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/moodboard test -- api.test.ts`
Expected: FAIL — `patchItemPinned` is not exported from `./api`.

- [ ] **Step 3: Add the `pinned` field to `MoodboardItem`**

In `artifacts/moodboard/src/types/index.ts`, add the field next to `completed`:

```ts
export interface MoodboardItem {
  id: string;
  type: "substack" | "youtube" | "link" | "photo" | "movie" | "reel" | "quote";
  url: string;
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  size?: number;
  gridX?: number;
  gridY?: number;
  addedAt: string;
  completed?: boolean;
  pinned?: boolean;
  note?: string;
  board?: string;  // 'moodboard' | 'discover' — undefined treated as 'moodboard'
  meta?: string;   // JSON string; type-specific extras, parsed by consumers
}
```

- [ ] **Step 4: Add `patchItemPinned` to `lib/api.ts`**

In `artifacts/moodboard/src/lib/api.ts`, immediately after `patchItemComplete` (after its closing `}` at line 56):

```ts

export async function patchItemPinned(
  id: string,
  pinned: boolean,
): Promise<void> {
  const res = await fetch(`${BASE}/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) {
    if (res.status === 401) notifyUnauthenticated();
    throw new Error(`Failed to update item: ${res.status}`);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @workspace/moodboard test -- api.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workspace/moodboard typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add artifacts/moodboard/src/types/index.ts artifacts/moodboard/src/lib/api.ts artifacts/moodboard/src/lib/api.test.ts
git commit -m "feat(moodboard): add patchItemPinned API client + pinned field"
```

---

### Task 3: Card UI — pin toggle button (moodboard-multi-user)

**Files:**
- Modify: `artifacts/moodboard/src/components/DiscoverCard.tsx`
- Modify: `artifacts/moodboard/src/components/QuoteCard.tsx`
- Modify: `artifacts/moodboard/src/index.css` (insert after line 1882, the `.discover-card:hover .discover-edit-btn { opacity: 1; }` rule)

**Interfaces:**
- Consumes: `MoodboardItem.pinned` (from Task 2).
- Produces: `DiscoverCardProps.onTogglePin: (id: string) => void` and `QuoteCardProps.onTogglePin: (id: string) => void` — new required props both card components will need wired up by Task 4's `discover.tsx`/`quotes.tsx` changes. CSS classes `.card-pin` / `.card-pin--active`.

- [ ] **Step 1: Add the pin button to `DiscoverCard.tsx`**

Add `onTogglePin` to the props interface:

```ts
interface DiscoverCardProps {
  item: MoodboardItem;
  onRemove: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onEdit?: (id: string) => void;
  isHighlighted?: boolean;
}
```

Add a `PinIcon` function next to the other icon functions (after `EditIcon`, before `getStatusLabel`):

```tsx
function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.5l2 3.5H7l2-3.5z" />
    </svg>
  );
}
```

Update the component signature to accept `onTogglePin`:

```tsx
export function DiscoverCard({ item, onRemove, onToggleComplete, onTogglePin, onUpdateNote, onEdit, isHighlighted }: DiscoverCardProps) {
```

Add a `pinned` const next to the existing `completed` const:

```ts
  const completed = !!item.completed;
  const pinned = !!item.pinned;
  const hasNote = !!(item.note?.trim());
```

Add a `handlePin` handler next to `handleToggle`:

```tsx
  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(item.id);
  };
```

Add the button in the JSX, right after the "Remove button top-right" block (after its closing `</button>`, before the "Check button bottom-right" comment):

```tsx
      {/* Pin button top-right, left of remove */}
      <button
        className={`card-pin ${pinned ? "card-pin--active" : ""}`}
        onClick={handlePin}
        aria-label={pinned ? "Unpin item" : "Pin item"}
      >
        <PinIcon />
      </button>
```

- [ ] **Step 2: Add the pin button to `QuoteCard.tsx`**

Replace the full file contents with:

```tsx
import type { MoodboardItem } from "@/types";

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

  return (
    <div
      className={`quote-card quote-card--${color}`}
      data-item-id={item.id}
      data-highlight={isHighlighted ? "true" : undefined}
    >
      <p className="quote-card-text">{item.title}</p>
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
    </div>
  );
}
```

- [ ] **Step 3: Add CSS for `.card-pin`**

In `artifacts/moodboard/src/index.css`, right after this existing block (ends around line 1882):

```css
.discover-edit-btn:hover {
  background: rgba(60, 60, 60, 0.85);
  transform: scale(1.1);
}

.discover-card:hover .discover-edit-btn { opacity: 1; }
```

insert:

```css

/* ── Pin/favourite toggle button (top-right, left of remove) ── */

.card-pin {
  position: absolute;
  top: 8px;
  right: 40px;
  width: 26px;
  height: 26px;
  background: rgba(0, 0, 0, 0.55);
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 10;
}

.card-pin:hover {
  background: rgba(60, 60, 60, 0.85);
  transform: scale(1.1);
}

.discover-card:hover .card-pin,
.quote-card:hover .card-pin {
  opacity: 1;
}

.card-pin--active {
  opacity: 1;
  background: var(--bg-btn-add);
  color: #fff;
}

.card-pin--active:hover {
  background: var(--bg-btn-add);
  transform: scale(1.1);
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/moodboard typecheck`
Expected: errors about missing `onTogglePin` prop at the `DiscoverCard`/`QuoteCard` call sites in `discover.tsx`/`quotes.tsx` — expected at this point, since those call sites aren't updated until Task 4. Confirm the *only* errors are those two missing-prop errors (nothing else broken).

- [ ] **Step 5: Commit**

```bash
git add artifacts/moodboard/src/components/DiscoverCard.tsx artifacts/moodboard/src/components/QuoteCard.tsx artifacts/moodboard/src/index.css
git commit -m "feat(moodboard): add pin toggle button to Discover and Quote cards"
```

---

### Task 4: Page wiring — reorder on add, wire pin toggle (moodboard-multi-user)

**Files:**
- Modify: `artifacts/moodboard/src/pages/discover.tsx`
- Modify: `artifacts/moodboard/src/pages/quotes.tsx`

**Interfaces:**
- Consumes: `patchItemPinned` (Task 2), `DiscoverCardProps.onTogglePin` / `QuoteCardProps.onTogglePin` (Task 3).
- Produces: both pages compile cleanly against Task 3's card components; newly added items appear at the top; pinned items float above unpinned ones immediately on toggle, not just after reload.

- [ ] **Step 1: Update `discover.tsx`**

Change the import line to add `patchItemPinned`:

```ts
import { fetchItems, createItem, deleteItem, patchItemComplete, patchItemPinned, patchItemNote, patchItemEdit } from "@/lib/api";
```

Add a `sortItems` helper right after the `useColumnCount` function (before `interface DiscoverProps`):

```ts
function sortItems(items: MoodboardItem[]): MoodboardItem[] {
  return [...items].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });
}
```

Update `addItem` to prepend and re-sort instead of appending:

```ts
  const addItem = useCallback((item: MoodboardItem) => {
    setItems((prev) => sortItems([item, ...prev]));
    // Show thumbnail toast for reels and links that came in without an image
    if (!item.imageUrl && (item.type === "reel" || item.type === "link")) {
      setThumbToast(true);
      setTimeout(() => setThumbToast(false), 5000);
    }
    createItem(item).catch(() => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setAddError("Couldn't save — check your connection.");
      setTimeout(() => setAddError(null), 4000);
    });
  }, []);
```

Add a `togglePin` callback right after `toggleComplete`:

```ts
  const togglePin = useCallback((id: string) => {
    setItems((prev) => {
      const next = sortItems(
        prev.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i)),
      );
      const updated = next.find((i) => i.id === id);
      if (updated) patchItemPinned(id, updated.pinned ?? false).catch(() => {});
      return next;
    });
  }, []);
```

Pass `onTogglePin={togglePin}` to `DiscoverCard` in the JSX:

```tsx
                  <DiscoverCard
                    key={item.id}
                    item={item}
                    isHighlighted={item.id === highlightId}
                    onRemove={removeItem}
                    onToggleComplete={toggleComplete}
                    onTogglePin={togglePin}
                    onUpdateNote={updateNote}
                    onEdit={(id) => {
                      const found = items.find((i) => i.id === id);
                      if (found) setEditItem(found);
                    }}
                  />
```

- [ ] **Step 2: Update `quotes.tsx`**

Change the import line to add `patchItemPinned`:

```ts
import { fetchItems, createItem, deleteItem, patchItemEdit, patchItemPinned } from "@/lib/api";
```

Add the same `sortItems` helper right after the `useColumnCount` function (before `interface QuotesProps`):

```ts
function sortItems(items: MoodboardItem[]): MoodboardItem[] {
  return [...items].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });
}
```

Update `addItem` to prepend and re-sort:

```ts
  const addItem = useCallback((item: MoodboardItem) => {
    setItems((prev) => sortItems([item, ...prev]));
    createItem(item).catch(() => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setAddError("Couldn't save — check your connection.");
      setTimeout(() => setAddError(null), 4000);
    });
  }, []);
```

Add a `togglePin` callback right after `addItem`:

```ts
  const togglePin = useCallback((id: string) => {
    setItems((prev) => {
      const next = sortItems(
        prev.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i)),
      );
      const updated = next.find((i) => i.id === id);
      if (updated) patchItemPinned(id, updated.pinned ?? false).catch(() => {});
      return next;
    });
  }, []);
```

Pass `onTogglePin={togglePin}` to `QuoteCard` in the JSX:

```tsx
                  <QuoteCard
                    key={item.id}
                    item={item}
                    isHighlighted={item.id === highlightId}
                    onRemove={removeItem}
                    onTogglePin={togglePin}
                    onEdit={(id) => {
                      const found = items.find((i) => i.id === id);
                      if (found) setEditItem(found);
                    }}
                  />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/moodboard typecheck`
Expected: no errors.

- [ ] **Step 4: Run the frontend test suite**

Run: `pnpm --filter @workspace/moodboard test`
Expected: PASS (existing suite unaffected; confirms nothing broke).

- [ ] **Step 5: Commit**

```bash
git add artifacts/moodboard/src/pages/discover.tsx artifacts/moodboard/src/pages/quotes.tsx
git commit -m "feat(moodboard): show newest items first and wire up pin toggle"
```

---

### Task 5: Port the same change to the sibling `moodboard` repo

This repo (`moodboard`, single-user, path `/Users/deepinder/Desktop/Claude/Personal-projects/moodboard`) has byte-identical `discover.tsx`, `quotes.tsx`, `DiscoverCard.tsx`, `QuoteCard.tsx`, and `types/index.ts` to the pre-Task-1 state of this repo (verified: `diff` between the two repos' copies of these five files is empty). Its `items.ts`/`db.ts`/`api.ts` differ only in lacking `user_id`/auth scoping. It has **no test infrastructure** (no `vitest`, no `test` script in any `package.json`) — verify this task with `typecheck` and `build` only.

Work happens in a new branch in that repo, not a worktree (it isn't managed by this session's worktree tooling):

```bash
cd /Users/deepinder/Desktop/Claude/Personal-projects/moodboard
git checkout -b pin-and-reorder
```

**Files (all in `/Users/deepinder/Desktop/Claude/Personal-projects/moodboard`):**
- Modify: `artifacts/api-server/src/lib/db.ts`
- Modify: `artifacts/api-server/src/routes/items.ts`
- Modify: `artifacts/moodboard/src/types/index.ts`
- Modify: `artifacts/moodboard/src/lib/api.ts`
- Modify: `artifacts/moodboard/src/components/DiscoverCard.tsx`
- Modify: `artifacts/moodboard/src/components/QuoteCard.tsx`
- Modify: `artifacts/moodboard/src/pages/discover.tsx`
- Modify: `artifacts/moodboard/src/pages/quotes.tsx`
- Modify: `artifacts/moodboard/src/index.css`

- [ ] **Step 1: `lib/db.ts`** — append, after the final existing `ALTER TABLE` statement (`meta` column):

```ts
  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false
  `);
```

- [ ] **Step 2: `routes/items.ts`** — apply the same three changes as Task 1, **without** `user_id` scoping (this repo is single-user):

`rowToItem`:

```ts
function rowToItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    type: row.type,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
    subtitle: row.subtitle ?? undefined,
    imageUrl:
      (row.image_url as string | null) ??
      (row.image_data as string | null) ??
      undefined,
    size: row.size ? Number(row.size) : undefined,
    addedAt: row.added_at,
    completed: row.completed ?? false,
    pinned: row.pinned ?? false,
    note: (row.note as string | null) ?? undefined,
    board: (row.board as string | null) ?? "moodboard",
    meta: (row.meta as string | null) ?? undefined,
  };
}
```

`GET /items`:

```ts
router.get("/items", async (req, res) => {
  const board = (req.query.board as string | undefined) ?? "moodboard";
  try {
    const result = await pool.query(
      "SELECT * FROM items WHERE board = $1 ORDER BY pinned DESC, added_at DESC",
      [board],
    );
    res.json(result.rows.map(rowToItem));
  } catch {
    res.status(500).json({ error: "Failed to fetch items" });
  }
});
```

`PATCH /items/:id` — add `pinned` to the body type and a new branch right after the `completed` branch:

```ts
router.patch("/items/:id", async (req, res) => {
  const body = req.body as {
    completed?: boolean;
    pinned?: boolean;
    note?: string | null;
    title?: string | null;
    imageUrl?: string | null;
    subtitle?: string | null;
    meta?: string | null;
  };
  try {
    if (body.completed !== undefined) {
      await pool.query("UPDATE items SET completed = $1 WHERE id = $2", [
        body.completed,
        req.params.id,
      ]);
    }
    if (body.pinned !== undefined) {
      await pool.query("UPDATE items SET pinned = $1 WHERE id = $2", [
        body.pinned,
        req.params.id,
      ]);
    }
    if ("note" in body) {
```

(everything after `if ("note" in body) {` is unchanged).

- [ ] **Step 3: `types/index.ts`** — add `pinned?: boolean` next to `completed?: boolean`, same as Task 2 Step 3.

- [ ] **Step 4: `lib/api.ts`** — add, immediately after the existing `patchItemComplete` function:

```ts

export async function patchItemPinned(
  id: string,
  pinned: boolean,
): Promise<void> {
  const res = await fetch(`${BASE}/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) throw new Error(`Failed to update item: ${res.status}`);
}
```

(Note: this repo's `api.ts` has no `credentials`/`notifyUnauthenticated` — do not add them, matching every other function already in this file.)

- [ ] **Step 5: `components/DiscoverCard.tsx`** — apply the exact same edit as Task 3 Step 1 (props interface gets `onTogglePin`, `PinIcon` function, component signature, `pinned` const, `handlePin`, and the new button in the JSX after the remove button).

- [ ] **Step 6: `components/QuoteCard.tsx`** — replace with the exact same full file contents as Task 3 Step 2.

- [ ] **Step 7: `index.css`** — insert the exact same `.card-pin` / `.card-pin--active` CSS block from Task 3 Step 3, in the same location (right after `.discover-card:hover .discover-edit-btn { opacity: 1; }`).

- [ ] **Step 8: `pages/discover.tsx`** — apply the exact same edit as Task 4 Step 1 (import `patchItemPinned`, add `sortItems`, update `addItem`, add `togglePin`, pass `onTogglePin={togglePin}` to `DiscoverCard`).

- [ ] **Step 9: `pages/quotes.tsx`** — apply the exact same edit as Task 4 Step 2 (import `patchItemPinned`, add `sortItems`, update `addItem`, add `togglePin`, pass `onTogglePin={togglePin}` to `QuoteCard`).

- [ ] **Step 10: Typecheck and build**

Run: `pnpm run typecheck`
Expected: no errors.

Run: `pnpm run build`
Expected: succeeds.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: show newest items first and add pin/favourite to Discover and Quotes"
```

- [ ] **Step 12: Merge to main and push**

```bash
git checkout main
git merge --ff-only pin-and-reorder
git push origin main
git branch -d pin-and-reorder
```

---

### Task 6: Final whole-branch review and ship (moodboard-multi-user)

- [ ] **Step 1: Run the full backend and frontend suites**

Run: `pnpm --filter @workspace/api-server test`
Run: `pnpm --filter @workspace/moodboard test`
Run: `pnpm run typecheck`
Expected: all green.

- [ ] **Step 2: Manual smoke check**

Start the dev server (`pnpm --filter @workspace/api-server dev` and `pnpm --filter @workspace/moodboard dev`, or however this repo's `dev` workflow normally runs), log in, and in both the Discover and Quotes tabs: add an item and confirm it lands at the top; pin an older item and confirm it jumps above the newest item; unpin it and confirm it falls back to age order.

- [ ] **Step 3: Merge this feature branch to local `main` and push**

Follow this repo's established pattern (see recent commits: change-password, multi-account) — fast-forward merge to local `main`, no PR, push to `origin/main`.
