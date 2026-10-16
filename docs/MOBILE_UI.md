# Mobile UI

- Phones get their own layout in both orientations. Tablets and larger screens keep the desktop layout.
- The switch is made by media queries alone, so rotating a phone or resizing a window changes layout without a reload.

## Breakpoint

- Mobile is `(max-width: 767px), (max-height: 499px)`. An upright phone is narrow; a phone on its side is short.
- Desktop is the exact complement, `(min-width: 768px) and (min-height: 500px)`.
- A 768 by 1024 tablet is desktop. An iPad mini upright, 744px wide, is mobile.
- The query lives in two places that must stay in step:
	- `libs/ui/lib/mobile.ts` exports `MOBILE_MEDIA_QUERY` for script.
	- `libs/ui/styles/base.css` defines the Tailwind variants.
- Unlayered CSS in `base.css` and `viewer.css` repeats the query literally, because media queries cannot read variables.

## Using it

| Tool | Applies when |
| --- | --- |
| `mobile:` | The mobile query matches |
| `desktop:` | The mobile query does not match. Use it in place of `md:` for layout |
| `short:` | Height is under 500px, a phone on its side |
| `useIsMobile()` | Script needs a different tree, not just different classes |

- Prefer the variants. `useIsMobile` re-renders on change through `matchMedia` and returns `false` during server render.
- Tailwind only generates classes it finds written out in full. Build class names from literals, never from template strings such as `` `${variant}:h-12` ``.
- Grids that should go to two columns on a phone held sideways use `sm:` rather than `desktop:`.
- Test setups mock `matchMedia` to `matches: false`, so tests render desktop. Override `window.matchMedia` in a test to render mobile.

## App header and tab bar

- `Header` renders `MobileHeader` on mobile: a slim top bar with the logo and the points balance, which opens Purchase.
- Generate, Presentations, and Marketplace move to a tab bar fixed to the bottom of the screen. The current page carries `aria-current="page"`.
- The last tab opens the account menu as a bottom `Sheet`: balance, Profile, Settings, Feedback, Report a bug, and Sign Out.
- The tab bar is a sibling of the header, not a child. The header's backdrop filter would otherwise contain the fixed bar.
- A page under the tab bar keeps its last content clear of it. The header carries `data-app-header` and `data-tab-bar`, and `base.css` pads the parent of that header.
- Auth pages show the top bar without tabs.
- `--ss-tab-bar-height` holds the bar's height on mobile. The anchored ad uses it to sit directly above the bar. See [Ads](ADS.md).

## Sheets and dialogs

- `libs/ui/components/sheet.tsx` is a shadcn-style `Sheet` on the Radix dialog. It opens from the `bottom` or the `right`.
- Bottom sheets have a grab handle, scroll within 85% of the screen height, and clear the home indicator.
- `Dialog` keeps its centred layout on desktop. On mobile it opens as a bottom sheet up to 90% of the screen height, with a 44px close button.
- Enter and exit use the `ss-sheet-*` and `ss-fade-*` keyframes in `base.css`. Reduced motion shortens every `data-state` animation to nothing.

## Deck viewer

- `viewer.css` holds the phone layout. Components mark their parts with classes such as `viewer-header__label`, `viewer-navigation__counter`, and `viewer-slide-controls`.
- Upright phone:
	- The top bar holds back, the title, and Present, Share, Edit, and Iterate as icon buttons. Button labels stay in the accessibility tree.
	- The slide is fitted to the space between the bars. Thumbnails sit below it at 80 by 45.
	- The bottom bar holds Download, the pager with a slide count, and Delete. First and Last are dropped.
	- In edit mode the editing tools scroll sideways at full touch size.
- Phone on its side: the editing tools join the top bar, thumbnails are hidden so the whole slide shows, and both bars are slimmer.
- Presenting: a sideways swipe of 48px or more turns the slide.
- The slide is fitted with container units. `.viewer-slide-area` is a size container and `--ss-slide-fit` takes the smaller of its width and its height times 16/9.
- Upright tablets keep the desktop chrome but use the same fit, so a tall screen does not crop the slide.
- The iterate panel takes the full screen width.

## Generate

- The prompt and a full-width Generate button come first. The options follow as a plain list, one per row, at 56px.

## Touch

- Fields are 16px on mobile so iOS does not zoom into them on focus.
- Interactive targets in the mobile bars are at least 44px.
- Controls that appear on hover also appear on focus or on screens without hover:
	- The remove button on a card list item and the widget toolbar show while their item or widget holds focus.
	- While editing, a widget takes focus when tapped, so a chart shows its toolbar too. On a screen without hover a hidden toolbar ignores taps.
	- The template menu's remove button stays visible where `(hover: none)` matches, in place of the selected check.
- `index.html` sets `viewport-fit=cover` and a `theme-color` matching the page background. Bars pad themselves with `env(safe-area-inset-*)`.
