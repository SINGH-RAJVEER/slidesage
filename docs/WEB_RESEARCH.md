# Web research

- Web research supplies sources for generation through Exa.
- Set `EXA_API_KEY` and `EXA_REQUEST_TIMEOUT_MS`.
- Each successful search costs one point, including for BYOK users. Failed searches refund the fee.
- Research uses the server key, never a user's BYOK key.

## Research flow

1. The API validates the research request and calls Exa.
2. The web application displays returned sources for review.
3. The user proceeds with the reviewed source payload.
4. The Go generation route includes those sources in the provider prompt.
5. The resulting presentation stores the reviewed sources for attribution.

- Request fields and limits are listed in [API input limits](API_OVERVIEW.md#input-limits).
