# IAM for Microservices — nIAM vs. Industry Providers

> A grounded comparison of nIAM's machine-to-machine (M2M) IAM design against
> Ping, WSO2, Okta/Auth0, Keycloak, AWS IAM and SPIFFE/SPIRE — based on what
> this demo actually implements and what those providers document.

---

## 1. What is happening in this demo

The demo proves nIAM works as an **external IAM provider for machine-to-machine
communication** between microservices. Two independent services
(`orders-svc` :4100, `payments-svc` :4101) never import IAM code — they are
pure wire clients.

### The request flow

1. **Token acquisition (rare path)** — `orders-svc` POSTs
   `grant_type=client_credentials` + its `client_id`/`client_secret` to
   `/t/{tenant}/oauth2/token` → the nIAM STS signs a **short-lived JWT
   (10 min TTL)** with claims: `iss` (tenant-scoped issuer), `aud`
   (`payments-api`), `scope`, `client_type: service`, `jti`, `exp`, `tenant`.
   Cached until ~30s before expiry.
2. **Service-to-service call (hot path)** — `Authorization: Bearer <jwt>`
   directly to `payments-svc`. **nIAM is never on the per-request path.**
3. **Local validation** — `payments-svc` verifies the JWT itself using nIAM's
   published JWKS: discovery fetched once, JWKS cached 10 min, refreshed only
   on an unknown `kid` (key rotation). Per-request cost is a local signature
   check, zero network calls to nIAM.
4. **Authorization** — `requireScope()` middleware checks the scope per route
   → `401` (no/bad token), `403` (insufficient scope).

### Lifecycle operations proven

| Operation | Standard | What the demo shows |
|---|---|---|
| Introspection | RFC 7662 | STS confirms `active: true` + full claims, on demand |
| Revocation | RFC 7009 | token's `jti` goes on a denylist; introspection reports inactive immediately |
| Token exchange | RFC 8693 | delegation: `sub` preserved, `act: { sub: orders-svc }` stamped — the on-behalf-of audit trail |
| gRPC fast lane | `iam.v1` (:50051) | typed protobuf twins: `Introspect`, `Decide` (a PDP), `GetJWKS` |

### IAM-side features (verified in `elysia_niam`)

- Service accounts support **4 auth methods**: `client_secret`,
  `private_key_jwt` (RFC 7523), `mtls`, `spiffe`
- **`allowed_Grant_Types`** per account (least-privilege grants)
- **Secret rotation with grace window** — the old secret keeps working until
  callers rotate
- **Scope registry** — admin-governed vocabulary, unique per (name, audience),
  duplicate = 409
- **Policy engine (PDP)** — deny-overrides semantics: any matching deny wins,
  else first permit, else implicit deny; conditions on `subject.*` /
  `resource` / `env.*` attributes
- **mTLS gateway** (`sts/mtls/mtlsGateway.ts`)
- Human side: `hr-software/` does OIDC `authorization_code + PKCE` SSO

---

## 2. The core verdict

**The 4-step flow above is the industry-standard pattern — all major providers
support it.** Ping, WSO2, Okta, Auth0, Keycloak, Azure AD/Entra and Google all
implement exactly this shape. The RFCs (6749, 7662, 7009, 8693, 7517)
guarantee wire-format compatibility — a client built against `lib/niam.ts`
could switch providers by changing a base URL.

What differs between providers is **where validation and policy decisions
happen** (see §4).

---

## 3. How each provider implements it

### Ping (PingOne / PingFederate / PingAuthorize) — same flow + a separate PDP tier

- Token issuance, introspection (RFC 7662) and revocation work identically.
- The difference is **PingAuthorize** — a dedicated policy decision point
  deployed as a **sidecar/gateway next to your services**. Instead of a local
  `requireScope("payments:charge")` check, calls route through the sidecar,
  which evaluates centrally-managed policies with real-time contextual data.
- Ping's hot path: *service → sidecar PDP → backend*. nIAM's hot path:
  *local scope check → backend*. Ping trades latency (extra hop) for central
  policy control. nIAM's gRPC `Decide` PDP is the same concept but **opt-in**.

### WSO2 Identity Server — same flow, gateway-centric variant

- `client_credentials` tokens can be **self-contained JWTs** (like nIAM) or
  **opaque reference tokens** (a random ID that only means something to WSO2).
  With opaque tokens, every request *must* call introspection — the IAM is on
  the hot path, which nIAM's design explicitly avoids.
- WSO2's flagship pattern is the **API Microgateway**: a gateway process
  downloads the token-binding config and validates JWTs **locally** (same idea
  as nIAM's cached-JWKS verifier), so services behind the gateway don't
  validate at all — the gateway does.
- The introspecting client must authenticate with its own client credentials
  (same as nIAM's STS).

### Okta / Auth0 — closest to nIAM

- Identical 4 steps. Auth0 calls it "Machine-to-Machine applications"; Okta
  calls it "service app + default scopes."
- Validation is local JWKS with caching; both additionally offer SDK
  middleware (Okta JWT Verifier, Auth0 express-jwt) — the equivalent of
  `lib/niamMiddleware.ts`.
- Neither offers a gRPC IAM surface; everything is REST.

### Keycloak — same flow with two quirks

- JWTs are signed with the **realm key**, validated locally via the realm's
  JWKS; adapters (Spring, Node) do what the nIAM middleware does.
- Quirk 1: by default Keycloak access tokens are opaque-ish session-backed
  unless configured as JWT.
- Quirk 2: revocation ("not before" per realm/client) is **coarse-grained** —
  it invalidates *all* tokens for a client, not per-`jti` like nIAM's
  denylist. nIAM's per-token revocation is finer-grained.

### AWS IAM / SPIFFE-SPIRE — the non-OAuth schools

- **AWS**: no OAuth at all — SigV4 request signing with IAM role credentials,
  or IRSA. Different protocol, same principle (short-lived credentials,
  local verification via trust anchors).
- **SPIFFE/SPIRE**: workload identity via **mTLS SVIDs** — no bearer tokens,
  identity is bound to the TLS channel. Stronger against token theft;
  heavier infrastructure.

---

## 4. Side-by-side on the 4 steps

| Step | nIAM | Ping | WSO2 | Okta/Auth0 | Keycloak |
|---|---|---|---|---|---|
| 1. client_credentials | ✅ + `allowed_Grant_Types` per account | ✅ | ✅ (JWT or opaque token) | ✅ | ✅ |
| 2. Bearer to service | ✅ direct | ✅ but often via PDP sidecar | ✅ often via microgateway | ✅ direct | ✅ direct |
| 3. Local validation | ✅ cached JWKS, kid-refresh | ✅ (or delegate to sidecar) | ✅ at gateway; opaque → must introspect | ✅ cached JWKS | ✅ cached JWKS |
| 4. Scope check | ✅ per-route middleware | ✅ central policy engine | ✅ gateway scopes | ✅ scopes + RBAC | ✅ roles/clients |
| Revocation granularity | per-`jti` denylist | per-token | per-token | per-token | per-client/realm (coarse) |
| PDP with conditions | ✅ opt-in gRPC `Decide` | ✅ PingAuthorize (core product) | ✅ via APIM policies | ✅ FGA (separate product) | partial |
| gRPC transport | ✅ `iam.v1` | ❌ | ❌ | ❌ | ❌ |
| Multi-tenancy | tenant-scoped issuer, JWKS, denylist | orgs | tenants | orgs/realms | realms |
| Auth methods | secret, private_key_jwt, mTLS, SPIFFE enum | secret, private_key_jwt, mTLS | secret, private_key_jwt | secret, private_key_jwt, mTLS | broad |
| Workload attestation | ❌ (roadmap: `spiffe`) | ❌ | ❌ | ❌ | ✅ native (SPIRE) |

---

## 5. The one real architectural fork: where the policy decision lives

1. **Embedded (nIAM, Okta, Auth0, Keycloak)** — the service itself checks
   scopes locally. Fastest, most resilient (IAM down ≠ services down), but
   policy is baked into code.
2. **Gateway (WSO2, Kong, Apigee)** — a gateway in front of services validates
   centrally. One enforcement point, but the gateway is now a hot-path
   dependency.
3. **Sidecar PDP (Ping, OPA-style)** — service-local enforcement *plus*
   real-time central policy. Most flexible, one extra hop.

**nIAM's positioning:** pattern 1 with an opt-in bridge to pattern 3 (the
gRPC `Decide` PDP) — simple by default, central policy when you need it.

---

## 6. Where nIAM is ahead / behind

### Ahead of most providers

- **Additive gRPC `iam.v1` fast lane** — neither Okta, Auth0, Ping nor
  Keycloak offers typed binary IAM transport. Genuinely differentiated.
- **Per-`jti` revocation** — finer-grained than Keycloak's coarse
  client/realm invalidation.
- **`spiffe` auth-method enum** in the service-account model — the roadmap
  hook for workload identity.

### Gaps vs. the mature providers (honest list)

1. **Revocation lag** — a revoked token still passes local validation until
   TTL. Okta mitigates with short TTLs + proactive introspection on
   high-value routes; SPIFFE with ~hourly SVID rotation. nIAM's answer is the
   same: keep TTLs at 10 min, use introspection (or the gRPC `Decide` PDP) on
   sensitive routes — already supported.
2. **No JWKS push** — providers cache-poll like nIAM, but SPIRE *streams* key
   updates. The `.proto` notes server-streaming `GetJWKS` as the plan.
3. **No mTLS on the gRPC channel yet** — RFC 8705 is documented-but-not-wired
   (see the `.proto` header comments).
4. **No workload attestation** — SPIFFE/SPIRE auto-issues identities to
   workloads at runtime; nIAM provisions accounts manually (like
   Okta/Auth0 — mainstream company).

---

## 7. The communication standards in play

| Standard | Role in the demo |
|---|---|
| RFC 6749 §4.4 | `client_credentials` grant |
| RFC 7517 / 7518 | JWKS key distribution; RS256/ES256 (alg pinned from the JWK — no `alg`-confusion attacks) |
| RFC 7662 | token introspection |
| RFC 7009 | token revocation |
| RFC 8693 | token exchange / delegation (`act` claim) |
| RFC 7636 | PKCE (human OIDC side, `hr-software/`) |
| OIDC Discovery | `.well-known/openid-configuration` |
| gRPC + proto3 | CNCF-standard typed contract; one `.proto` generates stubs in any language (Go/Java/Python/Rust…) |
| RFC 8705 / SPIFFE | documented roadmap (mTLS on gRPC, workload identity) |

---

## 8. Bottom line

Nothing in nIAM's flow is non-standard — a Ping or WSO2 customer reading the
README recognizes every step. The forks (opaque tokens, gateway validation,
sidecar PDP) are **deployment choices** those vendors make, not protocol
differences, and nIAM's architecture supports all three postures. The demo
proves 12 scenarios end-to-end, including the negative cases (tampered
signatures, scope denial, revoked tokens).
