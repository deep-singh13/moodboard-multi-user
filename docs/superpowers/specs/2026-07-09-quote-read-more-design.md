# Quote "Read More" Truncation — Design

## Context

Quote cards in the Quotes tab render the full quote text with no length limit.
A long quote (screenshot: a quote spanning ~35+ lines) makes its card far
taller than its neighbors, breaking the masonry grid's visual symmetry.
Short quotes stay compact; nothing currently caps the outliers.

This applies to both `moodboard-multi-user` (this repo) and the sibling
single-user repo at `/Users/deepinder/Desktop/Claude/Personal-projects/moodboard`
— their `QuoteCard.tsx`/`index.css` are otherwise identical (verified: no
diff between the two repos' copies as of the last shared port).

## Goals

- A quote card never grows taller than ~11 lines of text.
- When a quote is longer than that, it's visibly truncated with a "Read
  more" button; clicking it opens a popup showing the complete quote.
- Short quotes are completely unaffected — no button, no visual change.

## Non-goals

- No truncation anywhere else (Discover card titles/subtitles are already
  short; the note editor already has its own 300-character limit and its
  own UI). Scope is `QuoteCard`'s quote text only.
- No "read more" for the author/subtitle line — quote authors are always
  short in practice.
- No server-side truncation — this is a purely client-side rendering
  concern; the full text is always stored and fetched as-is.

## Truncation mechanism

CSS line-clamp, not a character-count cutoff — the earlier character-based
approach was replaced per explicit direction ("around 11 lines threshold
sounds good"). Line-clamp adapts naturally to the masonry grid's variable
column width (2/3/4 columns depending on viewport), where a fixed character
count would wrap to a different number of lines at each breakpoint.

`.quote-card-text` gets a clamped variant:

```css
.quote-card-text--clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 11;
  line-clamp: 11;
  overflow: hidden;
}
```

This class is applied unconditionally (every quote card renders clamped by
default) — for quotes under 11 lines, clamping has no visible effect, so no
separate "is this quote long" check gates whether the CSS applies.

## Overflow detection (client-side)

CSS clamping alone doesn't tell the component whether text was actually
cut off, so the "Read more" button must not appear for short quotes.
`QuoteCard` measures this directly:

- A `ref` on the `<p className="quote-card-text quote-card-text--clamped">`
  element.
- A `ResizeObserver` (created once per card instance, on mount) observing
  that element. On every resize callback, compare `scrollHeight` to
  `clientHeight`: if `scrollHeight > clientHeight + 1` (1px epsilon for
  subpixel rounding), the text is overflowing its clamp and
  `isOverflowing` is set to `true`; otherwise `false`.
- `ResizeObserver` (not a one-time mount check) is used specifically
  because column width — and therefore how many words fit per line —
  changes when the window is resized across the 2/3/4-column breakpoints,
  which can flip a quote from clamped-and-truncated to
  clamped-but-fits-fine or vice versa.
- The observer disconnects on unmount.

The "Read more" button renders only when `isOverflowing` is `true`.

## Popup

New component `components/QuoteReadMoreModal.tsx`:

- Props: `text: string` (the full quote), `author?: string` (subtitle),
  `onClose: () => void`.
- Reuses the existing `.modal-overlay`/`.modal-drawer`/`.modal-handle`
  bottom-sheet pattern (same structure as `ChangePasswordModal`): a
  fixed-position overlay, click-outside-to-close via a ref comparison,
  and a drawer sliding up from the bottom.
- `.modal-label` reads "Quote".
- The full quote text renders in a new `.modal-quote-text` block (styled
  like `.quote-card-text` — same serif/italic treatment — but without the
  clamp, and with `max-height: 60vh; overflow-y: auto;` so an extremely
  long quote scrolls within the drawer instead of overflowing the
  viewport).
- The author renders below it in a `.modal-quote-author` block (styled
  like `.quote-card-author`), only if `author` is present.
- A single "Close" button (`.modal-btn-secondary`, full-width) at the
  bottom — no "primary" action needed since this is read-only.

## Wiring into QuoteCard

- New local state: `const [isOverflowing, setIsOverflowing] = useState(false)` and `const [showFull, setShowFull] = useState(false)`.
- The quote text `<p>` gets `ref={textRef}` and the `quote-card-text--clamped`
  class always applied alongside the existing `quote-card-text` class.
- When `isOverflowing`, render a `.quote-read-more-btn` button ("Read
  more") right after the `<p>`, before the existing author line. Clicking
  it sets `showFull` to `true`.
- When `showFull` is `true`, render `<QuoteReadMoreModal text={item.title} author={item.subtitle} onClose={() => setShowFull(false)} />` as a sibling at the end of the card's JSX (outside the card's own `onClick`/button handlers, same pattern as how `EditQuoteModal`/`AddQuoteModal` are conditionally rendered by the parent page — except this one is scoped to the card itself since it doesn't need to reach the page's item list).
- The "Read more" button calls `e.stopPropagation()` (matching every other
  interactive element already inside `QuoteCard`, e.g. `handleEdit`,
  `handleRemove`) so it doesn't trigger any card-level click behavior.

## Testing

No test infra exists for `QuoteCard`/page-level components in either repo
(confirmed during the pin/favourite feature). Verification here is
typecheck (both repos) plus manual browser verification in
`moodboard-multi-user` (the only repo with a running dev workflow in this
session) — add a quote long enough to exceed 11 lines, confirm the button
appears and the popup shows the full text; confirm a short quote shows no
button.
