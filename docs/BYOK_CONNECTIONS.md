# BYOK provider connections

Use OpenAI, Google Gemini, or Anthropic keys for direct generation and AI revisions.

## Eligibility

- Connecting or replacing a key and changing the selected model require more than 50 points.
- Existing connections remain visible, usable, and removable below that threshold.
- Direct generation is billed by the provider and consumes no SlideSage model points.
- Exa research still costs one point per successful request and uses the server key.

## Credential handling

- The authenticated API validates keys against the provider's model-list endpoint and encrypts them with AES-256-GCM, a random IV, and user/provider metadata.
- Keys must contain 8 to 512 characters after trimming and cannot contain newlines or null bytes.
- The API never returns plaintext keys or logs credentials and raw provider responses.
- `PROVIDER_VALIDATION_TIMEOUT_MS` bounds the complete catalog request, including pagination; the default is 15 seconds. Caller cancellation stops it early.

| Provider | Catalog | Model filter |
| --- | --- | --- |
| OpenAI | `GET /v1/models` | Structured-output-capable GPT and o-series families, including matching fine-tunes; excludes incompatible task-specific variants |
| Google | Paginated `GET /v1beta/models` | Models advertising `generateContent` |
| Anthropic | Paginated `GET /v1/models` | Models advertising structured-output support |

- Catalogs come from the connected key. Listing bounds pages and bytes, deduplicates IDs, and rejects invalid IDs.
- Selection saves validate against a fresh catalog. Generation uses the validated encrypted selection without another catalog request.
- A missing or delisted selection defaults to the first compatible model in provider order.
- Independent catalogs load concurrently, with at most three requests per response and one active catalog request per provider per API process.
- Definitive key rejection or loss of compatible models invalidates the connection. Transient failures preserve it and show a provider-local warning.

| Provider result | API response |
| --- | --- |
| `401` or `403` | `403 PROVIDER_KEY_REJECTED` |
| No compatible models | `422 PROVIDER_NO_COMPATIBLE_MODELS` |
| Unavailable catalog | `502 PROVIDER_VALIDATION_UNAVAILABLE` |

Configure encryption:

```dotenv
BYOK_ENCRYPTION_KEY_CURRENT_VERSION=1
BYOK_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
```

- The version selector is non-secret; every key value is secret.
- Keep versioned keys available while stored credentials reference them. See [Encryption variables](ENVIRONMENT_VARIABLES.md#byok-credential-encryption).

## Routing

- Manage connections on `/settings` through `GET /ai/config`.
- The first valid connection selects its first compatible model. Removing the final valid connection restores point-funded OpenRouter.
- Generation uses the saved provider and never silently switches to another direct provider.
- Each provider has an enable switch. Disabling the selected provider restores point-funded OpenRouter while retaining its key and model.
- Enabling a provider selects its first compatible model until the user chooses another.
- Each connected row has a delete control and its own model dropdown. Configuration loading uses row skeletons.

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/ai/connections` | Create, `201` |
| `PUT` | `/ai/connections/:provider` | Replace, `200` |
| `PUT` | `/ai/connections/:provider/enabled` | Pause or resume with `{ "enabled": boolean }` |
| `PUT` | `/ai/selection` | Save provider and model |
| `DELETE` | `/ai/connections/:provider` | Delete, `204` with no body |

## Deployment

- Apply migrations before starting the API. Connections require migration 10; switches require migration 19.
- Configure the encryption keys for API and worker.
- Deploy both API and web when changing the connection contract. Unauthenticated `GET /ai/config` should return `401`.
- Creation/replacement and selection/deletion have separate per-user [rate limits](RATE_LIMITING.md).
- Provider reasoning budgets and retries are documented in [Generation worker](GENERATION_WORKER.md#worker-lifecycle).
