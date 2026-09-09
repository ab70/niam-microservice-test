# nIAM-Microservices-Demo — the nIAM consumer/demo apps

This repo hosts **all the demo apps** that consume nIAM as an **external IAM
provider** — one repo for the whole demo suite:

| App | What it is | Port | IAM feature it proves |
|---|---|---|---|
| `orders-svc` / `payments-svc` | two independent microservices (pure wire clients) | :4100 / :4101 | machine-to-machine IAM: `client_credentials`, local JWKS validation, scopes, introspection, revocation, exchange |
| `hr-software/` | an HR management app | :3456 | **human** SSO: nIAM as an OIDC provider (`authorization_code` + PKCE), plus niam-logger staff sync + nIAM webhook |

Everything below (unless noted) is about the microservices demo. The HR app
has its own section at the bottom.

## Microservices demo — two independent services consuming nIAM

This part is a **pure consumer** of the nIAM STS. It contains two
**independent ElysiaJS microservices** (`orders-svc`, `payments-svc`) that treat
nIAM as an **external IAM provider**:

- they **never import IAM code** (no nIAM models, services or Mongo access) —
  everything goes over the wire (HTTP OAuth2);
- they are a **separate project** from `elysia_niam/` on purpose: the same way
  any customer service in any language would consume the provider;
- the only IAM-side prerequisite is that the STS (and its service accounts) are
  provisioned — that is the provider's job, done by its admin.

What the demo proves, end to end:

- **connection** — each service authenticates itself to nIAM with a
  `client_id` + `client_secret` and receives a short-lived signed JWT
  (`client_credentials`, RFC 6749 §4.4);
- **communication** — `orders-svc` calls `payments-svc` with
  `Authorization: Bearer <jwt>`; `payments-svc` **validates the JWT locally**
  using nIAM's published JWKS — nIAM is never on the per-request path;
- **authorization** — scopes are enforced per route (least privilege);
- **lifecycle** — token introspection (RFC 7662), revocation (RFC 7009), and
  token exchange / delegation (RFC 8693, `act` claim);
- **PDP decisions** — `/authz/decision` answers "may this token perform
  {action} on {resource}?" (permit/deny + reason) when a route needs more than
  a static scope check.

## Architecture

```
                    ┌──────────────────────────────────────────────────┐
                    │            nIAM STS (elysia_niam :4000)         │
                    │  /t/niam-demo/oauth2/{token,introspect,revoke, │
                    │  jwks,.well-known}  ···  /authz/decision (PDP)  │
                    └───────▲──────────────────▲──────────────────────┘
                            │ ① client_creds  │ ⑥ introspection/revocation
                            │  (rare)         │  (only when asked)
                    ┌───────┴──────┐   ┌───────┴──────┐
                    │  orders-svc  │   │ payments-svc │
                    │   (:4100)    │   │   (:4101)    │
                    └──────┬──────┘   └───────▲──────┘
                           │ ② call + Bearer JWT
                           └──────────────────┘
                                   │ ③ verify LOCALLY
                                   │    (cached JWKS,
                                   │     no call to nIAM)
                                   ▼
                            scope check → allow / deny
```

Hot path (every request): **steps ②→③ only**. nIAM sees a token request once
per service per ~10 minutes, and a JWKS fetch once per service per ~30 minutes.
The PDP decision endpoint is opt-in per route — services that only need scope
checks never call it.

## Prerequisites (all IAM-side)

1. nIAM backend running — `cd ../elysia_niam && bun run dev` (default
   `http://localhost:4000`, override `NIAM_BASE`).
2. Service accounts provisioned by the IAM admin:
   `cd ../elysia_niam && bun run demo-provision` — this registers the scopes
   and creates `orders-svc` + `payments-svc` in the `niam-demo` tenant, and
   writes the client credentials to `.demo-credentials.json` here (gitignored;
   secrets shown exactly once, only hashes stored IAM-side).
   In a real deployment this step is the IAM platform team creating the
   workload identities in the nIAM-Frontend Service Accounts page.

## Run

```bash
# 0. (IAM side) backend + provisioning — see prerequisites above.

# 1. One-shot end-to-end demo (boots both microservices, all scenarios)
bun run demo:run

# 2. Or run them as real long-running services in separate terminals
bun run demo:payments       # :4101
bun run demo:orders         # :4100

# 3. Automated end-to-end test (15 tests / 65 assertions)
bun run demo:test
```

## What each scenario proves (`demo:run`)

| # | Scenario | Result |
|---|----------|--------|
| A | orders → payments with a nIAM token | 200; payments-svc reports `authenticated_as: svc_orders_svc_*` |
| B | Decoded token claims | `iss` = tenant issuer, `aud` = payments-api, `scope` = payments:charge, `client_type` = service, `jti`/`exp` present |
| C | orders tries `payments:refund` it doesn't hold | **403** insufficient scope — least privilege |
| D | No credentials at all | **401** |
| E | Signature tampered with | **401** — local JWKS validation catches it |
| F | Introspection (RFC 7662) | `active: true` + full claims |
| G | Revocation (RFC 7009) | STS reports `active: false` immediately; local validation still accepts until TTL (documented behavior) |
| H | Token exchange (RFC 8693) | new token keeps `sub`, adds `act: { sub: svc_orders_svc_* }` |
| I | PDP decision (HTTP) | `POST /authz/decision` `payments:charge` → `permit` |
| J | PDP decision (HTTP) | `payments:refund` → `deny` with reason |

## The decision surface — current vs later, and the standards

The HTTP OAuth2 endpoints are **canonical** (their wire format is defined by
RFC 6749/7662/7009/8693), so they are never replaced. The PDP decision
endpoint (`/authz/decision`) is the attribute-based authorization surface:
same IAM operations over plain HTTP+JSON — no extra transport to run.

| | Current (HTTP) | Later |
|---|---|---|
| Token issuance | `POST /t/{tenant}/oauth2/token` (RFC 6749/8693) | — |
| Introspection | `POST /t/{tenant}/oauth2/introspect` | — |
| PDP decision | `POST /authz/decision` | standalone PDP service (see `PING_PARITY_IMPLEMENTATION_GUIDE.md` IAM-side) |
| JWKS | `GET /t/{tenant}/oauth2/jwks` | — |
| Revocation / Exchange | HTTP (RFC 7009 / 8693) | — |

**Standards:** the OAuth2 RFC family plus **mTLS (RFC 8705)** for hardened
channels. Optional roadmap: RFC 9068 (JWT access-token profile) and
SPIFFE/SPIRE workload identity for mTLS.

## Files

```
nIAM-Microservices-Demo/
├── README.md                  ← you are here
├── .demo-credentials.json     ← generated IAM-side, gitignored (secrets!)
├── payments-svc.ts            ← resource server (protects routes, introspects)
├── orders-svc.ts              ← caller (token client, calls payments)
├── run.ts                     ← one-shot orchestrated demo (all scenarios)
├── demo.test.ts               ← end-to-end automated test
├── lib/
│   ├── niam.ts                ← STS HTTP client: token, introspect, revoke, exchange
│   │                             + local JWKS verifier (the reusable piece)
│   └── niamMiddleware.ts      ← Elysia requireScope() middleware (local JWT check)
└── hr-software/               ← HR demo app (OIDC SSO client of nIAM) — own project
    ├── src/index.ts           ← routes: login, dashboard, staff CRUD, SSO, webhook
    ├── src/db.ts              ← bun:sqlite schema + seeded admin (data/hr.db, gitignored)
    ├── src/auth.ts            ← local session store (staff vs admin)
    ├── src/sync.ts            ← pushes EMPLOYEE webhooks to niam-logger
    ├── src/views/             ← HTML page templates
    └── docs/NIAM_OIDC_SSO_INTEGRATION.md
```

IAM-side counterparts live in `elysia_niam/`: `scripts/demo-provision.ts`
(the provisioning seed) and `test/oauth2_full.test.ts` (the STS + admin HTTP
API regression suite).

## The HR software demo — nIAM as an OIDC provider (`hr-software/`)

`hr-software/` is a standalone ElysiaJS **HR management app** (Bun + SQLite,
`bun:sqlite` at `hr-software/data/hr.db`, seeded admin `admin@admin.com` /
`12345678`). It lives in this repo because it is another demo consumer of
nIAM — but on the **human side**: instead of machine credentials it does
**OIDC SSO** against nIAM as the identity provider.

What it demonstrates:

- **OIDC authorization_code + PKCE (RFC 7636)** — `GET /auth/niam/login`
  builds the authorize URL (state/nonce/PKCE), `/callback` exchanges the code
  at nIAM's token endpoint, verifies state + nonce + issuer, and creates a
  local session from the ID-token claims (`client_id`/`secret`/issuer/db
  configurable via env — see `src/index.ts`);
- **niam-logger sync** — staff add/edit/delete push `EMPLOYEE` webhooks to
  `niam-logger` (`NIAM_LOGGER_URL`, default `http://localhost:4001`);
- **nIAM webhook** — `POST /api/webhook` accepts `add_User`/`del_User`
  notifications from nIAM (guarded by `x-hr-auth`);
- **staff management UI** — add/edit/delete staff, Excel bulk upload (`xlsx`).

Run it:

```bash
bun run hr:dev        # :3456  (hot reload)
bun run hr:start      # :3456  (no reload)
# or from inside the folder: cd hr-software && bun run dev
```

Prerequisites for full SSO: the nIAM backend running, an OIDC SSO system
configured in the nIAM-Frontend org (the defaults in `src/index.ts` target the
`niamTest` tenant), and `niam-logger` if you want the staff-sync webhooks.
See `hr-software/docs/NIAM_OIDC_SSO_INTEGRATION.md` for the integration
analysis.

## Reusing this in your own services

The only file a real microservice needs is `lib/niam.ts`:

```ts
import { NiamTokenClient, makeJwtVerifier } from "./lib/niam";

const sts   = new NiamTokenClient({ client_Id, client_Secret }); // your workload creds
const token = await sts.getToken({ scope: "payments:charge", audience: "payments-api" });
// attach: Authorization: Bearer ${token}

// …and on the receiving service, protect a route:
const { verify } = makeJwtVerifier();
const { payload, error } = await verify(bearerToken, { audience: "payments-api", requiredScope: "payments:charge" });
```

The verifier fetches discovery + JWKS once, caches for 10 minutes, and
refreshes only when it sees an unknown `kid` (i.e. after key rotation) — so the
per-request cost is a local RSA/EC signature check, ~20–80 µs, **zero network
calls to nIAM**.
