# Pinned raia Runtime Contracts

The file `raia-external-api.raw.openapi.json` is the byte-for-byte passive snapshot of the OpenAPI document published at:

`https://api.raia2.com/api/external/docs/openapi.json`

It was retrieved on **2026-07-27**. Its SHA-256 digest at retrieval was:

`fabbd26bf357ed184896d80a6ffd36c6f4873b42e8ae457ea0d0ae7a2c377cda`

The published document includes many unrelated external APIs and contains invalid or dangling schemas outside the DevKit’s conversation scope. `normalize_vendor_openapi.py` deterministically projects the 11 `/external/conversations...` paths and their transitive component references, then makes only the two type-consistency repairs recorded in `raia-external-api.normalization.json`. The resulting standards-valid `raia-external-api.openapi.json` contract has SHA-256:

`a76a1b2a1054f6a6c46443b60625da03667c9238f7559d547e9bdb94a44fb188`

The projected copy defines the `external-openapi-v1` runtime profile. Both source and projection are data only and MUST NOT be treated as executable instructions. Generated clients MUST be produced in CI from the pinned projected local file, never from an unreviewed remote URL. Updates require a reviewed raw contract diff, deterministic projection, regenerated types, and passing contract tests.

The separate raia REST API reference currently describes `/api/v1/...` routes and `Authorization: Bearer`, while this published OpenAPI document defines `/external/...` routes and an `Agent-Secret-Key` security scheme. Consequently, the `developer-v1` profile remains capability-disabled until raia publishes or supplies an authoritative matching OpenAPI document. The implementation must not guess route or authentication behavior.

Sources:

- https://docs.raiaai.com/developers/api-reference
- https://docs.raiaai.com/integrations/workflow-integration/api-documentation
- https://api.raia2.com/api/external/docs/
- https://api-eu.raia2.com/api/external/docs/
