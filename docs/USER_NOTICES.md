# User notices

Every transient error or confirmation the web app shows is rendered through a single component, `FloatingNotice` (`libs/ui/components/FloatingNotice.tsx`), exported from `@slidesage/ui`. It is a pill pinned below the header's top-right corner that mirrors the active generation indicator, and it dismisses itself after four seconds.

## Props

| Prop | Type | Meaning |
| --- | --- | --- |
| `error` | `string \| null \| undefined` | Error message. Takes precedence over `success`. |
| `success` | `string \| null \| undefined` | Confirmation message. |
| `onDismiss` | `() => void` | Called when the notice times out. Must clear the state that produced the message. |

An error renders with `role="alert"`, a warning icon, and a red border; a success renders with `role="status"`, a check icon, and an emerald border. Both are `aria-live="polite"`. Rendering nothing when both messages are empty is the component's own responsibility, so callers pass state through unconditionally.

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

Where the message is owned upstream and the component cannot clear it — `IterateModal` receives its error from the streaming state — track the acknowledged message locally and derive what is visible from it, rather than adding a clear callback to the parent.

## What stays inline

The notice replaces feedback that follows a user action. Blocking states that own a whole page or panel and carry their own recovery action keep their inline treatment, since a self-dismissing pill would take the retry affordance with it:

- `PresentationErrorPage`, the dedicated route for a failed generation (its retry failure message uses the notice)
- The research failure block on `GenerateResearchPage`, which offers **Retry research**
- The template preview failure on `MarketplaceThemePreviewPage`, which offers **Retry**
- The "AI settings could not be loaded" state in `AISettings`, which replaces the whole panel. It is tracked separately from the panel's confirmations, which do go to the notice
- The "Email verified" block on `VerifyEmailPage`, which replaces the form for the terminal state of the flow
- The preview rendering status in the viewer, which carries its own retry link
