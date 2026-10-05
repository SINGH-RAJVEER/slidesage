# User notices

- Use `FloatingNotice` from `@slidesage/ui` for transient action feedback.
- It appears below the header's top-right corner and dismisses after four seconds.
- Use errors for failed actions and warnings for conditions the user can correct before proceeding. Rejected generation submissions are errors and keep the user on the page.

## Props

| Prop | Type | Purpose |
| --- | --- | --- |
| `error` | `string \| null \| undefined` | Highest-priority message |
| `warning` | `string \| null \| undefined` | Shown when no error exists |
| `success` | `string \| null \| undefined` | Shown when no error or warning exists |
| `onDismiss` | `() => void` | Clear the state that produced the message |

- Errors use `role="alert"`, a warning icon, and red styling.
- Warnings use `role="status"`, a warning icon, and amber styling.
- Success uses `role="status"`, a check icon, and emerald styling.
- All notices use `aria-live="polite"`. Empty messages render nothing.

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

## What stays inline

Keep states that replace a page or panel and provide recovery controls inline:

- `PresentationErrorPage`; retry failures use a notice.
- A failed research search on `GenerateResearchPage`: the reason stays in place of the sources, and Retry research replaces Proceed to Generate.
- A failed outline request on `OutlinePage`: the reason stays in place of the outline beside Back to generate; a refused draft submission keeps the outline and uses a notice.
- The load failure in `AISettings`; action confirmations use a notice.
- The terminal Email verified state on `VerifyEmailPage`.
