# Pin/Favourite + Newest-First Ordering — Design

## Context

The Discover and Quotes tabs currently list items oldest-first (`ORDER BY
added_at ASC`), so newly added items land at the bottom of the masonry grid.
This adds two related changes: newest items on top, and a way to pin
specific items so they stay above everything else regardless of age.

This design applies identically to both `moodboard` (single-user) and
`moodboard-multi-user` (multi-account) — their `items` schema and route code
are otherwise the same, differing only in the multi-user repo's `user_id`
scoping on every query.

## Goals

- New items appear at the top of the Discover and Quotes grids, not the
  bottom.
- A user can pin/favourite any item in Discover or Quotes so it stays above
  unpinned items, independent of when it was added.
- Same behavior in both repos.

## Non-goals

- No changes to the main moodboard canvas (freeform-positioned board, not a
  sorted list — "pin to top" doesn't apply there).
- No pin ordering by "time since pinned" — pinned items sort by `added_at`
  among themselves, same as unpinned items. Simpler, and mirrors the
  existing `completed` boolean's lack of its own timestamp.
- No limit on how many items can be pinned.

## Data model

Add one column, in both repos' `initDb()`:

```sql
ALTER TABLE items ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false
```

Same idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern already
used for `note`, `board`, and `meta`.

## Backend

In both repos' `routes/items.ts`:

- `rowToItem()` includes `pinned: row.pinned ?? false`.
- `GET /items` query changes from `ORDER BY added_at ASC` to
  `ORDER BY pinned DESC, added_at DESC`.
- `PATCH /items/:id` gains a `pinned` branch, identical in shape to the
  existing `completed` branch:
  ```ts
  if (body.pinned !== undefined) {
    await pool.query("UPDATE items SET pinned = $1 WHERE id = $2 [AND user_id = $3]", ...);
  }
  ```
  (multi-user version keeps its `user_id` scoping, same as every other
  branch in that handler).

## Frontend

- `types/index.ts`: `MoodboardItem.pinned?: boolean`.
- `lib/api.ts`: new `patchItemPinned(id: string, pinned: boolean): Promise<void>`,
  same shape as `patchItemComplete`.
- `pages/discover.tsx` / `pages/quotes.tsx`:
  - `addItem` optimistic update changes from `[...prev, item]` to
    `[item, ...prev]` so a just-added item shows at the top immediately,
    matching the new server ordering.
  - New `togglePin(id)` callback, same shape as `toggleComplete`
    (optimistic local update + `patchItemPinned` fire-and-forget).
  - Server already returns items pre-sorted (`pinned DESC, added_at DESC`);
    the masonry column-distribution logic (`i % numCols`) is unchanged and
    just consumes the already-sorted `displayed` array, so pinned items
    naturally land near the top of each column.
- `components/DiscoverCard.tsx` / `components/QuoteCard.tsx`:
  - New pin toggle button, placed top-right, left of the existing remove
    button (both cards already have edit top-left and remove top-right;
    the pin button sits between them at `right: 40px`).
  - Uses a simple pin/thumbtack SVG (matching the existing icon style:
    `stroke="currentColor" strokeWidth="2.5"`, 11×11 viewBox 24).
  - Active (pinned) state gets a filled/highlighted treatment, reusing the
    same visual pattern as `.card-check--done` (e.g. a new
    `.card-pin--active` class with an accent fill/background, defined
    alongside the other card-button state classes in `index.css`).
  - `aria-label` toggles between "Pin item" / "Unpin item".

## Testing

- Backend: extend each repo's `items.test.ts` — pin an item and assert it
  sorts before a more-recently-added unpinned item; unpin and assert it
  falls back into age order; PATCH with `pinned` persists across a
  subsequent GET.
- Frontend: extend `lib/api.test.ts` with a `patchItemPinned` case (same
  shape as the existing `patchItemComplete` case). No `discover.tsx`/
  `quotes.tsx` page-level tests exist yet in either repo, and adding that
  harness is out of scope here — pin/reorder behavior in those pages is
  covered by the backend ordering tests plus manual verification in the
  browser.
