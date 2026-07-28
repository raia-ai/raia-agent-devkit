# ADR 0006 — WP6 HTTP and conversation providers

Status: accepted · Scope: WP6 (`@raia/provider-http`, `@raia/conversation-client`, `apps/mock-management-api`, live evaluation wiring)

## 1. The conforming server is a product artifact, not test scaffolding

`apps/mock-management-api` wraps the existing `MockManagementProvider` in an
HTTP server that speaks the exact wire contract of
`contracts/raia-management.openapi.yaml`: `/me` … `/traces/{traceId}` paths,
required `Idempotency-Key` (16–200 chars) and `If-Match` headers, `ETag` and
`X-Request-Id` response headers, `Retry-After` on 429/503, and
`application/problem+json` failures carrying `{type, title, status, requestId,
code}`. The status mapping is one table (`ProviderErrorCode → HTTP status`),
so the client's reverse mapping is tested against the same vocabulary. Since
the proposed management API is not live anywhere, this server is the only
executable definition of "conforming" — the contract tests in
`@raia/provider-http` run the real client against it over real sockets.

## 2. Retry policy: bounded, jittered, and honest about what is safe

`withRetry` retries only typed-retryable codes — `RATE_LIMITED`,
`UNAVAILABLE`, `TIMEOUT`, `INTERNAL` — and never `AUTHENTICATION_REQUIRED`,
`PERMISSION_DENIED`, `NOT_FOUND`, `CONFLICT`, `STALE_BASE`,
`IDEMPOTENCY_MISMATCH`, `INVALID_TRANSITION`, `VALIDATION_FAILED`,
`POLICY_FAILED`, or `EVALUATION_GATE_FAILED` (spec §18). Mutation retries are
safe because every management mutation carries an Idempotency-Key; the server
replays the original response. `Retry-After` wins over backoff when present
(seconds or HTTP-date, capped at 60 s); otherwise delay is
`min(base·2^(attempt−1), max) · jitter`, with injectable `sleep`/`random`.
Both attempts (default 3) and elapsed wait time (default 15 s) are capped.

## 3. Credential kinds are the management/conversation boundary

`ManagementCredential` (`oauth-access-token` | `service-token`, from
`RAIA_ACCESS_TOKEN`) and `AgentSecretCredential` (`agent-secret-key`, from
`RAIA_AGENT_SECRET_KEY`) are discriminated types. `HttpManagementProvider`
enforces the boundary twice: the type system rejects an agent secret, and
`assertManagementCredential` refuses it at runtime with a typed
`AUTHENTICATION_REQUIRED` naming why ("scoped to one agent's conversation
runtime"). The management env reader deliberately never reads
`RAIA_AGENT_SECRET_KEY`, and the conversation client authenticates with the
pinned contract's `Agent-Secret-Key` header — never a bearer token. Tests
cover both directions, including that token material never reaches log
entries.

## 4. Conversation client generation is pinned and drift fails closed

`scripts/generate-contract.mjs` reads only the audited projection under
`docs/raia-devkit-spec/contracts/vendor/`, verifies both recorded checksums
(`fabbd26b…` raw, `a76a1b2a…` projected) against the actual bytes, and emits
`src/generated/contract-constants.ts`: checksums, the two pinned regional
servers, security schemes, and the `operationId → {method, path}` table the
client dispatches through. `check-contract-sync.mjs` regenerates and compares
byte-for-byte in CI, so a modified vendor file or hand-edited constants fail
closed. Profile gating per spec §16: `external-openapi-v1` is the only
executable profile; `developer-v1` throws `CapabilityUnavailableError`
(capability-disabled until raia publishes an authoritative `/api/v1`
contract); `custom-openapi` accepts a local file path for doctor reporting
only and cannot execute; unknown profile names are typed failures, never
guesses. `CAPABILITY_UNAVAILABLE` is a client-specific error class because
`ProviderErrorCode` has no such member.

## 5. RECORDED CONTRACT GAPS: provider contract vs pinned vendor contract

Three `ConversationProvider` surface points cannot be expressed by the pinned
external contract. Each fails closed with a typed error rather than inventing
an endpoint or dropping input silently:

1. `deleteConversation(conversationId)` — the pinned contract defines only
   "delete all conversations for a user" (`DELETE /external/conversations`
   with a user id body), not a per-conversation delete →
   `CapabilityUnavailableError`.
2. `createConversation({channel})` — channel-scoped creation maps to the
   email/sms/voice `/start` flows, outside the DevKit's text-evaluation scope
   → `CapabilityUnavailableError`.
3. The pinned `CreateConversationBodyDTO` requires `conversationUserId`,
   which the normative provider contract does not model → taken from
   `user.id` or the configured `conversationUserId`, else a typed
   `VALIDATION_FAILED` explains exactly what to provide.

Upstream note: reconciling the normative `ConversationProvider` with the
published external contract (per-conversation delete, user identity) is a
raia platform decision; until then fail-closed is the only honest behavior.

## 6. Live evaluation runs through the executor seam

`createLiveCaseExecutor` adapts `ConversationProvider` to the eval-engine's
`CaseExecutor`: one fresh conversation per case, user turns sent in order,
final assistant reply recorded as the observation, latency measured with an
injectable clock. Tool calls and conversation-state transitions are not
observable over the conversation surface, so those assertions evaluate
against empty observations instead of fabricated ones. The engine's result
model gains `mode: "live"` and records the runtime profile as `provider`.
`raia test --mode live` prints the cost/network notice, resolves the profile,
and fails closed (exit 4 without a credential, exit 1 for disabled profiles).
Conversation operations are never retried automatically: message sends can
incur model cost and the vendor contract defines no idempotency. Base-URL
overrides (`RAIA_CONVERSATION_TEST_BASE_URL`) are restricted to loopback so
an Agent Secret Key can never be redirected to an arbitrary remote host.

## 7. Remote change plans and evaluation runs stay typed-unavailable

The mock's `createChangePlan` / `createEvaluationRun` / `getEvaluationRun`
continue to fail closed with `UNAVAILABLE` (messages updated to state the
final rationale instead of "arrives in WP3/WP6"): the deterministic core is
authoritative for semantic diffs, and evaluations execute in the local
eval-engine — fixture mode or live mode via the pinned runtime. The HTTP
client still implements all three operations against the wire contract (the
conforming server surfaces the typed 503), so a future hosted implementation
needs no client change.

## 8. The CLI's http provider is opt-in and pinned

`providerForBinding` now supports `provider: "http"`, constructed from
`RAIA_ACCESS_TOKEN` plus the binding's region (`us`/`eu` → the two pinned
`/agent-devkit/v1` endpoints) or the `apiBaseUrl` recorded explicitly in
`.raia/project.json`. `raia init` still creates only mock bindings — the
proposed management API is not live, so selecting http is a deliberate
binding edit, not a guessable flag. `raia doctor` reports the conversation
runtime (profile, contract checksum, server, auth scheme, credential
presence — never values) and fails only when the profile itself is
misconfigured, since fixture mode needs no runtime.
