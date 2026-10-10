# User notices

- Use `FloatingNotice` from `@slidesage/ui` for transient action feedback.
- It appears below the header's top-right corner and dismisses after four seconds.
- Use errors for failed actions and warnings for conditions the user can correct before proceeding. Rejected generation submissions are errors and keep the user on the page.
- A failed research search on `GenerateResearchPage` is an error notice; the page swaps Proceed to Generate for a Retry research button.

## Props

| Prop | Type | Purpose |
| --- | --- | --- |
| `error` | `string \| null \| undefined` | Highest-priority message |
| `warning` | `string \| null \| undefined` | Shown when no error exists |
| `success` | `string \| null \| undefined` | Shown when no error or warning exists |
| `onDismiss` | `() => void` | Clear the state that produced the message |
| `action` | `{ label: string; onClick: () => void } \| null \| undefined` | Button shown beside the message, such as Undo |

- Errors use `role="alert"`, a warning icon, and red styling.
- Warnings use `role="status"`, a warning icon, and amber styling.
- Success uses `role="status"`, a check icon, and emerald styling.
- All notices use `aria-live="polite"`. Empty messages render nothing.
- `NOTICE_TTL_MS` is exported so a page can time an action window to the notice.

## Usage

Mount once per page after `<Header />`:

```tsx
<Header />
<FloatingNotice
	error={error}
	success={success}
	onDismiss={() => {
		setError(null);
		setSuccess(null);
	}}
/>
```

- Pass message state unconditionally. Fixed positioning keeps the notice independent of the affected control.
- Use this component instead of page-local error boxes, inline action errors, or `Alert` blocks.
- If upstream state cannot be cleared, copy the message into local state and clear that copy on dismissal.
- Implementation: `libs/ui/components/FloatingNotice.tsx`.

## Undoing a deletion

Deletes take one click and offer Undo on the notice instead of a confirmation dialog:

- Slides in `DeckWorkspace` are removed and autosaved at once. Undo re-inserts the card at its old position.
- Presentations in `PresentationsGridPage` leave the grid at once, but the `DELETE` request waits `NOTICE_TTL_MS`. Undo cancels it. A second deletion, leaving the page, or closing the tab sends the pending request. A failed request restores the presentation and shows an error.
- Pass a `key` that changes per deletion so back-to-back deletions restart the notice timer.
- A new deletion clears any error on the notice so Undo is visible. Hide the action if a later error takes over the notice.

## What stays inline

Keep states that replace a page or panel and provide recovery controls inline:

- `PresentationErrorPage`; retry failures use a notice.
- The load failure in `AISettings`; action confirmations use a notice.
- The terminal Email verified state on `VerifyEmailPage`.
