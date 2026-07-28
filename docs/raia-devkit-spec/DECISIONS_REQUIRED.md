# Decisions Required Before Live raia Integration

The local core, mock provider, evaluation engine, CLI, MCP server, and Claude plugin can be built without resolving the decisions below. The HTTP provider can be implemented and contract-tested against a local server, but it must not be described as a live raia integration until the corresponding platform decisions are confirmed.

| Priority | Decision | Recommended default | Blocks |
| --- | --- | --- | --- |
| P0 | **Lifecycle authentication** | OAuth2/OIDC for users with a device or authorization-code flow; workspace-scoped service tokens for CI | Live discovery and all management writes |
| P0 | **Management API ownership and namespace** | A distinct `/agent-devkit/v1` service boundary, separate from every conversation-runtime route; the hostname and path remain illustrative until backend approval | Live HTTP provider |
| P0 | **Canonical conversation-runtime contract** | Designate a versioned OpenAPI document as authoritative. Until then, pin and implement `external-openapi-v1`; keep the conflicting `/api/v1/...` prose profile disabled rather than guessing its shapes or authentication. | WP6 live evaluation |
| P0 | **Canonical export contract** | Backend returns a lossless manifest, resolved lock data, version ID, and ETag | Reliable `pull`, round trip, and drift detection |
| P0 | **Version semantics** | Every accepted agent change creates an immutable version; drafts are mutable only until released | Release, rollback, and evidence binding |
| P0 | **Environment model** | At least `development`, `staging`, and `production`, with independent permissions and immutable deployment records | Staging deployment |
| P0 | **Authorization scopes** | Use the scopes proposed in the OpenAPI contract and enforce environment policy server-side | MCP and CLI mutation safety |
| P0 | **Secret references** | Manifests carry opaque `raia-secret://` references; only the runtime resolves values | Functions and integrations as code |
| P1 | **Resource identity** | Skills, functions, knowledge packs, policies, and integrations receive stable IDs, immutable versions, and checksums | Complete lock resolution and semantic diff |
| P1 | **Evaluation execution** | Fixture mode is local; live and remote evaluation runs execute in an isolated staging context with explicit usage attribution | Hosted evaluation and release gates |
| P1 | **Approval evidence** | Approvals are authenticated, role-aware records tied to candidate hash and cannot be edited after release | Governed release |
| P1 | **Trace access and redaction** | Server redacts before return; client redacts again, caps payloads, and records truncation | Safe `debug` and `learn` |
| P1 | **Rollback behavior** | Deployment captures its previous healthy release as an explicit rollback target | Reliable rollback and incident response |
| P1 | **Unknown-field round trip** | Export unsupported fields under a namespaced extension object until the schema natively supports them | Lossless Git/UI round trip |
| P2 | **Plugin distribution** | Publish through a raia-owned Claude Code marketplace/repository with signed release artifacts and checksums | General distribution, not local install |
| P2 | **Telemetry policy** | Off by default; collect only coarse command health after separate privacy review | Product analytics only |
| P2 | **Production workflow** | Keep production promotion in raia CX initially; reconsider after staging adoption and audit review | Post-MVP capability |

## Questions for the first backend review

The backend and product teams should answer these questions against `contracts/raia-management.openapi.yaml`:

1. Can the platform export every supported agent property without secret values, and can the same export be submitted without semantic loss?
2. Which existing internal objects already represent agent versions, drafts, knowledge versions, skills, functions, integrations, and environments?
3. Is there an existing workspace identity and OAuth issuer the CLI can use, or must one be introduced?
4. Can every mutation enforce optimistic concurrency and idempotency at the service boundary?
5. Can evaluation runs execute against an unreleased candidate without changing production state?
6. Can traces be queried by exact agent version and returned after server-side redaction?
7. Which release gates and approvals already exist in raia CX, and which should remain exclusively in the UI?
8. What are the US/EU data-residency requirements for exported manifests, evaluation fixtures, traces, and local caches?
9. Which conversation contract is canonical: the published `/external/...` OpenAPI using `Agent-Secret-Key`, or the docs-page `/api/v1/...` interface using `Authorization: Bearer`? If both remain supported, where are their independently versioned OpenAPI documents and deprecation policies?

## Default instruction to the implementing team

Until a decision is confirmed, keep it behind a capability check and provider interface. Do not spread placeholder conditionals through the domain layer, and do not relax a security rule to accommodate a missing backend feature.
