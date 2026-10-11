# Web research

- Web research supplies sources for generation through Exa.
- Set `EXA_API_KEY` and `EXA_REQUEST_TIMEOUT_MS`.
- Each successful search costs one point, including for BYOK users. Failed searches refund the fee.
- Research uses the server key, never a user's BYOK key.

## Research flow

1. With Web Research on, the Web Research button sets how many sources the search retrieves, from one to eight (default five). Hovering it or reaching it by keyboard fills the button in white up to the count. As with the scrubber in Apple's player, pressing anywhere on the button and dragging moves the fill by the distance dragged rather than jumping to the press; the control magnifies while held, and the label gives way to the count it would snap to. On release it snaps to the nearest count and the label fades back. The arrow, Home, and End keys adjust the count from the focused slider. A press that does not drag turns research off. The research page sends the count as `research.maxResults`.
2. The API validates the research request and calls Exa. Every search costs the same one point regardless of the result count.
3. The web application displays returned sources for review. The sources table and Proceed to Generate appear only after a successful search; a failed search keeps its reason on the page with a Retry research button.
4. The user may remove sources they do not want cited, and can restore them until research runs again. Removing sources does not refund the search.
5. The user proceeds with the remaining sources as the reviewed payload. Removing every source proceeds without research sources and does not trigger another search. A retried deck's approved outline goes along only while the sources are exactly the saved ones.
6. The Go generation route includes those sources in the provider prompt.
7. The resulting presentation stores the reviewed sources for attribution.

- Request fields and limits are listed in [API input limits](API_OVERVIEW.md#input-limits).
