# User notices

Every transient error or confirmation the web app shows is rendered through a single component, `FloatingNotice` (`libs/ui/components/FloatingNotice.tsx`), exported from `@slidesage/ui`. It is a pill pinned below the header's top-right corner that mirrors the active generation indicator, and it dismisses itself after four seconds.

## Props

| Prop | Type | Meaning |
| --- | --- | --- |
| `error` | `string \| null \| undefined` | Error message. Takes precedence over the other two. |
| `warning` | `string \| null \| undefined` | Warning message. Outranked by `error`, outranks `success`. |
| `success` | `string \| null \| undefined` | Confirmation message. |
| `onDismiss` | `() => void` | Called when the notice times out. Must clear the state that produced the message. |

An error renders with `role="alert"`, a warning icon, and red text on a red border; a warning renders with `role="status"`, the same icon, and amber text on an amber border; a success renders with `role="status"`, a check icon, and emerald text on an emerald border. All are `aria-live="polite"`. Rendering nothing when every message is empty is the component's own responsibility, so callers pass state through unconditionally.

A warning is for a state the reader can correct before the action succeeds, rather than one that already failed. A generation submission the API refuses is an error: `/generate` and `/generate/research` report it on the notice and stay on the page.

## Usage

Mount it once per page, directly after `<Header />`, and feed it the page's message state:

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

Because it is `position: fixed`, it does not need to sit near the control that failed. Do not add page-local error boxes, inline red text under a form, or `Alert` blocks for action feedback.

Where the message is owned upstream and the component cannot clear it, such as an error in the streaming state, copy it into local state when it changes and clear that copy on dismiss, rather than adding a clear callback to the parent.

## What stays inline

The notice replaces feedback that follows a user action. Blocking states that own a whole page or panel and carry their own recovery action keep their inline treatment, since a self-dismissing pill would take the retry affordance with it:

- `PresentationErrorPage`, the dedicated route for a failed generation (its retry failure message uses the notice)
- The research failure block on `GenerateResearchPage`, which offers **Retry research**
- The "AI settings could not be loaded" state in `AISettings`, which replaces the whole panel. It is tracked separately from the panel's confirmations, which do go to the notice
- The "Email verified" block on `VerifyEmailPage`, which replaces the form for the terminal state of the flow
