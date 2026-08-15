# nIAM OIDC SSO Integration — Architecture & Analysis

> **Date:** July 9, 2026  
> **Scope:** Analysis of nIAM (elysia_niam) as an OIDC Provider for the HR Software (hr-software)  
> **Standard:** OpenID Connect (OIDC) — Authorization Code Flow with PKCE

---

## 1. Does the nIAM System Model Follow a Standard?

**Yes — it follows the OIDC (OpenID Connect) Core 1.0 specification closely.**

The SSO configuration block in `elysia_niam/src/app/models/adminEnd/system.ts` has fields that directly map to the OIDC spec:

| Model Field | OIDC Spec Equivalent | Status |
|---|---|---|
| `protocol: "oidc"` | Declares this system as an OIDC RP client | ✅ |
| `issuer` | `iss` — the provider's issuer URL | ✅ |
| `audience` | `aud` — intended audience of the ID token | ✅ |
| `client_Id` / `client_Secret` | OAuth2/OIDC client credentials | ✅ |
| `redirect_Urls[]` | `redirect_uris` — registered callback URLs | ✅ |
| `scopes[]` | `scope` — e.g. `openid profile email` | ✅ |
| `signing_Algorithm: RS256` | `id_token_signing_alg_values_supported` | ✅ (RS256 is the **recommended** algorithm) |
| `subject_Claim` | `sub` — subject identifier claim | ✅ |
| `token_TTL_Seconds` | `expires_in` for tokens | ✅ |
| `require_PKCE` | PKCE (RFC 7636) for public clients | ✅ |
| `state_Required` | CSRF protection via `state` parameter | ✅ |
| `nonce_Required` | Replay protection via `nonce` parameter | ✅ |
| `discovery_Url` | OIDC Discovery metadata URL | ✅ |
| `authorization_Endpoint` | `authorization_endpoint` | ✅ |
| `token_Endpoint` | `token_endpoint` | ✅ |
| `userinfo_Endpoint` | `userinfo_endpoint` | ✅ |
| `jwks_Endpoint` | `jwks_uri` — JWK Set endpoint | ✅ |
| `mode: "sp_initiated"` | SP-initiated (RP-initiated) SSO flow | ✅ |

The schema also includes `"saml2"` as an available protocol option, making it forward-compatible with SAML 2.0 (implementation pending).

---

## 2. OIDC Provider — Implementation Status (Fully Functional)

The OIDC Provider is implemented in `elysia_niam/src/app/controllers/sso_Controllers/functions/oidc_provider.ts` and exposes **5 standard endpoints** via the route file `elysia_niam/src/routes/ssoRoute/ssoRoute.ts`:

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /api/sso/oidc/.well-known/openid-configuration` | Discovery | Returns OIDC metadata for a registered `client_id` |
| `GET /api/sso/oidc/jwks` | JWKS | Returns RS256 public signing keys for ID token verification |
| `GET /api/sso/oidc/authorize` | Authorization | Authorization Code flow entry point (user-facing) |
| `POST /api/sso/oidc/token` | Token | Exchanges authorization code for `id_token` + `access_token` |
| `GET /api/sso/oidc/userinfo` | UserInfo | Returns user claims for a valid access token |

**Key implementation details:**
- RS256 signing with auto-generated or environment-provided RSA key pair (`OIDC_PRIVATE_KEY` / `OIDC_PUBLIC_KEY`)
- Supports PKCE S256 and plain methods for public clients
- Supports `client_secret_post` and `client_secret_basic` token endpoint auth methods
- Authorization codes are in-memory (5-minute TTL) — in-memory `Map`
- Access tokens are opaque random strings (not JWTs), stored in-memory

---

## 3. Access Control — The Gatekeeper Model

**nIAM enforces access control at the OIDC Authorize step.** Before issuing an authorization code, nIAM checks the AccessTable to verify the user has access to that specific system.

### Authorize Flow (Explicit Access Check)

```
User clicks "Login with SSO" on external app
        ↓
Redirect to GET /api/sso/oidc/authorize?client_id=<id>&redirect_uri=<url>&...
        ↓
nIAM checks: Is the user already logged in to nIAM? (if not, prompt login)
        ↓
nIAM queries AccessTable for this user + this system's ID
    ├── NO MATCH → Return 403 "User is not entitled for this OIDC client"
    └── MATCH FOUND → Generate authorization code
                       ↓
            Redirect back to app's callback URL with ?code=<auth_code>&state=<state>
```

### Code Reference (from `oidc_provider.ts`)

```typescript
// Ensure user is actually entitled to access this system before issuing OIDC code.
const accessTable = await AccessTable(currentDB);
const accessDoc = await accessTable.findOne({ user_Id: userId }).lean();
const hasSystemAccess = accessDoc?.systems?.some(
  (s: any) => s.system_Id?.toString() === (systemDoc as any)._id.toString()
);
if (!hasSystemAccess) {
  return { success: false, status: 403, message: "User is not entitled for this OIDC client" };
}
```

### Token Exchange (Additional Validation)

At the token endpoint, nIAM also validates:
- The authorization code hasn't been consumed (single-use)
- The `client_secret` matches the registered system's secret
- The `redirect_uri` matches the original request
- PKCE `code_verifier` (if `code_challenge` was used)

---

## 4. Multi-System / Multi-Application Support

**Yes, multiple applications are fully supported.** Each external application is registered as a separate **System** in nIAM, each with its own OIDC client configuration.

| Per-System Field | What It Controls |
|---|---|
| `client_Id` | Unique identifier for each app (e.g. `hr_app`, `crm_app`) |
| `client_Secret` | Each app gets its own secret (auto-generated) |
| `redirect_Urls[]` | Each app can have its own allowed callback URLs |
| `issuer` | Each app can share the same issuer or use a custom one |
| `scopes[]` | Each app can request different scopes |
| `token_TTL_Seconds` | Each app can have different token lifetimes |
| `require_PKCE` | Can be enabled/disabled per application |

**Example scenario:**

| System | client_Id | Users with Access |
|---|---|---|
| HR App | `client_<sysId>_1234` | Alice, Bob, Charlie |
| CRM App | `client_<sysId>_5678` | Alice, Dave |
| Portal App | `client_<sysId>_9012` | Bob, Eve |

- **Alice** can log into HR App and CRM App via nIAM OIDC, but not Portal App
- **Bob** can log into HR App and Portal App, but not CRM App
- **Dave** can only log into CRM App

nIAM enforces these boundaries — the OIDC flow **will not issue tokens** for a system the user doesn't have access to.

---

## 5. HR Software — Current Authentication State

The HR app (`hr-software`) currently has:

- ✅ **Password-based login** with in-memory sessions
- ✅ Login page with Admin / Staff tabs (Staff = "Coming Soon")
- ❌ **No SSO / OIDC integration**

### Integration Gap

The HR app acts as a standalone auth system. To integrate with nIAM OIDC, it needs to become an **OIDC Relying Party (RP)** — it must:

1. Add an **"SSO Login with nIAM"** button to the login page
2. Add a **`/callback` route** to handle the OIDC redirect
3. Exchange the authorization code for tokens at nIAM's token endpoint
4. **Verify the ID token** using nIAM's JWKS endpoint (check `iss`, `aud`, `exp`, signature)
5. Create a **local session** from the verified claims

---

## 6. Standards Reference: OpenID Connect (OIDC)

**OpenID Connect** is an identity layer built on top of OAuth 2.0. Key roles:

| Role | In nIAM | Description |
|---|---|---|
| **OP** (OpenID Provider / IdP) | **nIAM** | Authenticates users and issues tokens |
| **RP** (Relying Party / Client) | **HR App** (or any external app) | Delegates authentication to the OP |
| **ID Token** | Signed JWT | Proves the user authenticated; contains `sub`, `email`, `name`, etc. |
| **Access Token** | Opaque string | Used to call the UserInfo endpoint |

### Why OIDC Over Custom SSO

| Aspect | Custom SSO (Legacy) | OIDC (Standard) |
|---|---|---|
| Protocol | Proprietary | Industry standard (OAuth2 + OIDC) |
| Interoperability | nIAM-specific | Any OIDC-compatible client library |
| Security | Token exchange only | PKCE, state, nonce, JWKS verification |
| Client Libraries | None | `openid-client`, `passport`, `oauth4webapi`, etc. |
| Future-proof | No | Yes — SAML 2.0 planned next |

---

## 7. Quick Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        nIAM (IdP)                           │
│                                                              │
│  ┌─────────────┐   ┌──────────────────┐   ┌───────────────┐ │
│  │ Auth         │   │ OIDC Provider    │   │ AccessTable   │ │
│  │ (Login/Sess) │──▶│ /authorize       │──▶│ (User-System  │ │
│  │              │   │ /token           │   │  Permissions) │ │
│  │              │   │ /userinfo        │   └───────────────┘ │
│  │              │   │ /jwks            │                     │
│  └─────────────┘   └──────────────────┘                     │
└──────────────────────────────────────────────────────────────┘
           ▲                                        │
           │ 1. Redirect to authorize               │ 2. Redirect back with code
           │    (?client_id=hr_app&...)                 (?code=xyz&state=abc)
           │                                        ▼
┌──────────────────────────────────────────────────────────────┐
│                    HR App (RP / Client)                      │
│                                                              │
│  ┌─────────────┐        ┌──────────────┐                    │
│  │ Login Page  │───▶     │ /callback    │──▶ Create local    │
│  │ (SSO btn)   │        │ Exchange code│    session +       │
│  │             │        │ Verify JWT   │    redirect to     │
│  │             │        │ via JWKS     │    /dashboard      │
│  └─────────────┘        └──────────────┘                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Full System Config Example (MongoDB Document)

When you register the HR App as a System in nIAM, the resulting MongoDB document in the `systems` collection will look like this. The `sso` block is what controls OIDC behavior.

### Minimal Registration Request

Send a `PATCH /api/system/system?id=<systemId>` with this body:

```json
{
  "sso": {
    "enabled": true,
    "protocol": "oidc",
    "mode": "sp_initiated",
    "application_Url": "http://localhost:3456",
    "redirect_Url": "http://localhost:3456/callback",
    "redirect_Urls": [
      "http://localhost:3456/callback"
    ],
    "issuer": "http://localhost:3000/api/sso/oidc",
    "audience": "hr_software_app",
    "scopes": ["openid", "profile", "email"],
    "token_TTL_Seconds": 300,
    "require_PKCE": true,
    "state_Required": true,
    "nonce_Required": true
  }
}
```

### What the DB Document Looks Like After Saving

**nIAM auto-generates** `client_Id` and `client_Secret` (see `editSystem_func.ts` lines 53-69). The final document:

```json
{
  "_id": "665f1a2b3c4d5e6f7a8b9c0d",
  "system_Name": "HR Software",
  "system_Ip": "192.168.1.100",
  "system_Type": "application",
  "systemEnabled": true,
  "connection": {
    "type": "DIRECT"
  },
  "sso": {
    "enabled": true,
    "protocol": "oidc",
    "mode": "sp_initiated",
    "client_Id": "client_665f1a2b3c4d5e6f7a8b9c0d_4821",
    "client_Secret": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b",
    "application_Url": "http://localhost:3456",
    "redirect_Url": "http://localhost:3456/callback",
    "redirect_Urls": [
      "http://localhost:3456/callback"
    ],
    "issuer": "http://localhost:3000/api/sso/oidc",
    "audience": "hr_software_app",
    "discovery_Url": "http://localhost:3000/api/sso/oidc/.well-known/openid-configuration",
    "authorization_Endpoint": "http://localhost:3000/api/sso/oidc/authorize",
    "token_Endpoint": "http://localhost:3000/api/sso/oidc/token",
    "userinfo_Endpoint": "http://localhost:3000/api/sso/oidc/userinfo",
    "jwks_Endpoint": "http://localhost:3000/api/sso/oidc/jwks",
    "signing_Algorithm": "RS256",
    "scopes": ["openid", "profile", "email"],
    "subject_Claim": "sub",
    "token_TTL_Seconds": 300,
    "require_PKCE": true,
    "state_Required": true,
    "nonce_Required": true
  },
  "createdAt": "2025-06-01T10:00:00.000Z",
  "updatedAt": "2025-06-01T10:00:00.000Z"
}
```

### How client_Id and client_Secret Are Generated

From `sso_utils.ts`:

```typescript
// client_Id pattern: "client_<mongoId>_<randomNumber>"
// Example: "client_665f1a2b3c4d5e6f7a8b9c0d_4821"

// client_Secret: HMAC-SHA256 hex digest of client_Id using NIAM_SSO_SECRET
// Example: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"
```

> **Important:** The `client_Secret` is **never returned** in subsequent API responses after creation. Save it securely in the HR app's environment variables when you first create the system.

---

## 9. What the HR Software Needs to Hit — Full Integration

The HR app needs these values from the nIAM system config (above) to integrate:

| HR App Env Variable | Source from nIAM Config | Example Value |
|---|---|---|
| `NIAM_OIDC_ISSUER` | `sso.issuer` | `http://localhost:3000/api/sso/oidc` |
| `NIAM_CLIENT_ID` | `sso.client_Id` | `client_665f1a2b3c4d5e6f7a8b9c0d_4821` |
| `NIAM_CLIENT_SECRET` | `sso.client_Secret` | `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d...` |
| `NIAM_REDIRECT_URI` | `sso.redirect_Url` | `http://localhost:3456/callback` |
| `NIAM_DB` | nIAM organization DB name | `acme_corp` |

### OIDC Endpoints the HR App Will Call

From the `issuer` base URL (`http://localhost:3000/api/sso/oidc`), all endpoints are derived:

| HR App Action | nIAM Endpoint | Method | Purpose |
|---|---|---|---|
| Fetch discovery metadata | `{issuer}/.well-known/openid-configuration?db=<db>&client_id=<id>` | GET | Auto-discover all OIDC endpoints |
| Redirect user for login | `{issuer}/authorize?client_id=<id>&redirect_uri=...&response_type=code&scope=...&state=...&nonce=...&code_challenge=...&code_challenge_method=S256` | GET | Send user to nIAM login |
| Exchange code for tokens | `{issuer}/token` | POST | Get `id_token` + `access_token` |
| Fetch user profile | `{issuer}/userinfo` | GET | Get user claims with Bearer token |
| Verify ID token signature | `{issuer}/jwks` | GET | Get RS256 public keys |

### Full Integration Process (Step by Step)

---

#### Step 1: HR App — Add OIDC Configuration to `.env`

```
# nIAM OIDC Configuration (from the system config created in nIAM)
NIAM_OIDC_ISSUER=http://localhost:3000/api/sso/oidc
NIAM_CLIENT_ID=client_665f1a2b3c4d5e6f7a8b9c0d_4821
NIAM_CLIENT_SECRET=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b
NIAM_REDIRECT_URI=http://localhost:3456/callback
NIAM_DB=acme_corp

# RS256 public key (fetched from JWKS, can cache)
# Or just fetch it at runtime from /jwks
```

---

#### Step 2: HR App — Add an SSO Login Button to the Login Page

On the login page, add a button/link pointing to nIAM's authorize endpoint.

**What the HR app constructs** (the redirect URL to nIAM):

```
GET {issuer}/authorize
  ?client_id={client_Id}
  &redirect_uri={redirect_URI (URL-encoded)}
  &response_type=code
  &scope=openid%20profile%20email
  &state={random_csrf_token}
  &nonce={random_nonce}
  &code_challenge={pkce_challenge}
  &code_challenge_method=S256
```

**Example real URL:**

```
http://localhost:3000/api/sso/oidc/authorize
  ?client_id=client_665f1a2b3c4d5e6f7a8b9c0d_4821
  &redirect_uri=http%3A%2F%2Flocalhost%3A3456%2Fcallback
  &response_type=code
  &scope=openid%20profile%20email
  &state=ET9mK2xR7qLp5vBn8wXz
  &nonce=H4sDf6gJkL2pQwEr7yUo
  &code_challenge=9xS8fG3hJ5kL2pQwEr7yUo1mN4bV6cXzA
  &code_challenge_method=S256
```

> **State:** Generate a random string, store it in the HR app session/cookie for CSRF verification on callback  
> **Nonce:** Generate a random string, store it to verify against the ID token's `nonce` claim  
> **PKCE:** Generate a random `code_verifier` (43-128 chars), compute `SHA256(verifier)` → base64url-encoded as `code_challenge`. Store the verifier for the callback.

---

#### Step 3: nIAM Authorizes (or Blocks)

- User must already be logged into nIAM (cookie/session)
- nIAM checks AccessTable for `user_Id` + `system_Id`
  - ❌ **No access** → HTTP 403 `"User is not entitled for this OIDC client"`
  - ✅ **Has access** → Issues auth code, redirects back to HR app

**nIAM redirects back to the HR app:**

```
http://localhost:3456/callback?code=abc123def456...&state=ET9mK2xR7qLp5vBn8wXz
```

---

#### Step 4: HR App — Handle the `/callback` Route

The HR app receives the callback. It must:

1. **Verify `state`** matches the one stored in step 2
2. **Exchange the `code`** for tokens at nIAM

```typescript
// POST to {issuer}/token
// Headers: Content-Type: application/json
// Body:
{
  "db": "acme_corp",
  "grant_type": "authorization_code",
  "code": "abc123def456...",          // from callback query param
  "redirect_uri": "http://localhost:3456/callback",
  "client_id": "client_665f1a2b3c4d5e6f7a8b9c0d_4821",
  "client_secret": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d...",
  "code_verifier": "original_verifier_string_from_step_2"
}
```

**nIAM response (success):**

```json
{
  "token_type": "Bearer",
  "expires_in": 300,
  "access_token": "kL9mN2pQ4rS6tU8vW0xY2zA4bC6dE8fG0hI2jK4lM6nO8pQ0rS2tU4vW6xY8z",
  "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im5pYW0tb2lkYy1yczI1Ni0xIn0.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvYXBpL3Nzby9vaWRjIiwic3ViIjoiNjdjMTIzYWI4OWVmMDAwMDEyMzRhYmNkIiwiYXVkIjoiaHJfc29mdHdhcmVfYXBwIiwiaWF0IjoxNzE3MjI4NDAwLCJleHAiOjE3MTcyMjg3MDAsIm5vbmNlIjoiSDRzRGY2Z0prTDJwUXdFcjd5VW8iLCJlbWFpbCI6ImpvaG4uZG9lQGFjbWUuY29tIiwibmFtZSI6IkpvaG4gRG9lIiwiZ2l2ZW5fbmFtZSI6IkpvaG4iLCJmYW1pbHlfbmFtZSI6IkRvZSJ9.abc123def456signature",
  "scope": "openid profile email"
}
```

---

#### Step 5: HR App — Verify the ID Token

The `id_token` is a **signed JWT** (RS256). The HR app must verify:

1. **Fetch JWKS** from nIAM: `GET {issuer}/jwks`

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "0ABC...full_modulus...XYZ",
      "e": "AQAB",
      "use": "sig",
      "alg": "RS256",
      "kid": "niam-oidc-rs256-1"
    }
  ]
}
```

2. **Verify the JWT signature** using the JWKS public key (matching the `kid` header)
3. **Verify claims:**
   - `iss` must equal the configured issuer URL
   - `aud` must equal the HR app's `client_id`
   - `exp` must not be expired
   - `nonce` must match the one generated in step 2 (if `nonce_Required: true`)

---

#### Step 6: HR App — Create Local Session

After verification, extract user claims and create a local session:

```typescript
// Decoded id_token payload:
const claims = {
  sub: "67c123ab89ef00001234abcd",    // nIAM user's _id (or email, depending on subject_Claim)
  email: "john.doe@acme.com",
  name: "John Doe",
  given_name: "John",
  family_name: "Doe"
};

// Check if user exists in HR app DB, or create
let localUser = db.query("SELECT id FROM users WHERE external_sub = ?").get(claims.sub);
if (!localUser) {
  db.query("INSERT INTO users (external_sub, email, firstName, lastName, role, active) VALUES (?, ?, ?, ?, 'staff', 1)")
    .run(claims.sub, claims.email, claims.given_name, claims.family_name);
}

// Create local session (using existing auth.ts)
const sessionToken = createSession(localUser.id);

// Set cookie and redirect to dashboard
return new Response(null, {
  status: 302,
  headers: {
    Location: "/dashboard",
    "Set-Cookie": `session=${sessionToken}; Path=/; HttpOnly; Max-Age=86400`
  }
});
```

---

### Example: Complete HTTP Flow (with Sample Data)

#### A) User clicks "Login with SSO" on HR App

```
User is on: http://localhost:3456/login
Clicks "Sign in with nIAM"

HR App generates:
  state = "ET9mK2xR7qLp5vBn8wXz"           (stored in temp cookie)
  nonce = "H4sDf6gJkL2pQwEr7yUo"           (stored in temp cookie)
  code_verifier = "pR3sT6vX9zB2nM5kH8jQ1wL4oP7rU0yF2cV5bN8mI1kD4gJ7"  (stored in temp cookie)
  code_challenge = base64url(sha256(code_verifier))
                  = "9xS8fG3hJ5kL2pQwEr7yUo1mN4bV6cXzA2sD5fG8hJ1kL4"

Redirect to: http://localhost:3000/api/sso/oidc/authorize
  ?client_id=client_665f1a2b3c4d5e6f7a8b9c0d_4821
  &redirect_uri=http%3A%2F%2Flocalhost%3A3456%2Fcallback
  &response_type=code
  &scope=openid+profile+email
  &state=ET9mK2xR7qLp5vBn8wXz
  &nonce=H4sDf6gJkL2pQwEr7yUo
  &code_challenge=9xS8fG3hJ5kL2pQwEr7yUo1mN4bV6cXzA2sD5fG8hJ1kL4
  &code_challenge_method=S256
```

#### B) nIAM processes authorize

```
User is logged into nIAM as: john.doe@acme.com

nIAM checks AccessTable for user "john.doe@acme.com" + system "665f1a2b3c4d5e6f7a8b9c0d"
  └─ ✅ Access granted (Alice has access to HR App)

nIAM issues auth code: "aB3xY7zK9pQ2rT5vW8nM1kL4hJ6gF2dS0aX3cV5bN8mI1kD4gJ7"
  └─ Code stored in memory for 5 minutes

Redirect back to: http://localhost:3456/callback
  ?code=aB3xY7zK9pQ2rT5vW8nM1kL4hJ6gF2dS0aX3cV5bN8mI1kD4gJ7
  &state=ET9mK2xR7qLp5vBn8wXz
```

#### C) HR App callback handler

```typescript
// 1. Verify state matches
if (callbackState !== storedState) {
  return redirect("/login?error=state_mismatch");
}

// 2. Exchange code for tokens
const tokenResponse = await fetch("http://localhost:3000/api/sso/oidc/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    db: "acme_corp",
    grant_type: "authorization_code",
    code: "aB3xY7zK9pQ2rT5vW8nM1kL4hJ6gF2dS0aX3cV5bN8mI1kD4gJ7",
    redirect_uri: "http://localhost:3456/callback",
    client_id: "client_665f1a2b3c4d5e6f7a8b9c0d_4821",
    client_secret: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b",
    code_verifier: "pR3sT6vX9zB2nM5kH8jQ1wL4oP7rU0yF2cV5bN8mI1kD4gJ7"
  })
});

const tokens = await tokenResponse.json();
// {
//   token_type: "Bearer",
//   expires_in: 300,
//   access_token: "kL9mN2pQ4rS6tU8vW0xY2zA4bC6dE8fG0hI2jK4lM6nO8pQ0rS2tU4vW6xY8z",
//   id_token: "eyJhbGciOiJSUzI1NiIsImtpZCI6Im5pYW0tb2lkYy1yczI1Ni0xIn0...",
//   scope: "openid profile email"
// }

// 3. Verify id_token signature using JWKS
const jwksResponse = await fetch("http://localhost:3000/api/sso/oidc/jwks");
const jwks = await jwksResponse.json();
// Decode JWT header → get kid → find matching key in jwks.keys → verify RS256 signature

// 4. Decode and verify claims
const decoded = jwt.verify(tokens.id_token, jwksPublicKey, {
  algorithms: ["RS256"],
  issuer: "http://localhost:3000/api/sso/oidc",
  audience: "client_665f1a2b3c4d5e6f7a8b9c0d_4821"
});
// Verify nonce matches too

// claims:
// {
//   "sub": "67c123ab89ef00001234abcd",
//   "email": "john.doe@acme.com",
//   "name": "John Doe",
//   "given_name": "John",
//   "family_name": "Doe",
//   "nonce": "H4sDf6gJkL2pQwEr7yUo"
// }

// 5. Create user in HR app if new
let localUser = db.query("SELECT id FROM users WHERE external_sub = ?").get("67c123ab89ef00001234abcd");
if (!localUser) {
  db.query("INSERT INTO users (external_sub, email, firstName, lastName, role, active) VALUES (?, ?, ?, ?, 'staff', 1)")
    .run("67c123ab89ef00001234abcd", "john.doe@acme.com", "John", "Doe");
}

// 6. Create local session
const sessionToken = createSession(localUser.id);

// 7. Redirect to dashboard with session cookie
return new Response(null, {
  status: 302,
  headers: {
    Location: "/dashboard",
    "Set-Cookie": `session=${sessionToken}; Path=/; HttpOnly; Max-Age=86400`
  }
});
```

#### D) User is logged in

```
User is now at: http://localhost:3456/dashboard
Authenticated via SSO through nIAM with local session
```

---

## 10. Required Env Vars for the HR App

| Variable | Value | Source |
|---|---|---|
| `NIAM_OIDC_ISSUER` | `http://localhost:3000/api/sso/oidc` | nIAM server URL + `/api/sso/oidc` |
| `NIAM_CLIENT_ID` | `client_665f1a2b3c4d5e6f7a8b9c0d_4821` | From system config (auto-generated) |
| `NIAM_CLIENT_SECRET` | `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d...` | From system config (auto-generated) |
| `NIAM_REDIRECT_URI` | `http://localhost:3456/callback` | Registered in system config |
| `NIAM_DB` | `acme_corp` | The nIAM organization DB name |

---

## 11. Error Scenarios the HR App Must Handle

| Scenario | What Happens | HR App Should Show |
|---|---|---|
| User not logged into nIAM | nIAM prompts login first | SSO button redirects to nIAM login |
| User has no access to HR App system | nIAM returns 403 at authorize endpoint | "Access denied — contact your administrator" |
| Authorization code expired (>5 min) | nIAM returns "Invalid or expired code" at token endpoint | "Session expired — please try again" |
| Callback state mismatch | HR app detects mismatch | "Security validation failed — please try again" |
| Code already consumed (replay) | nIAM rejects at token endpoint | "This link has already been used" |
| ID token signature invalid | HR app detects during verification | "Authentication verification failed" |
| Invalid client_secret at token endpoint | nIAM returns 401 | "Configuration error — contact support" |

---

## 12. Security Checklist

- ✅ Use **HTTPS only** in production for all OIDC endpoints
- ✅ **PKCE (S256)** — always use `code_challenge_method=S256`, never `plain`
- ✅ **State parameter** — verify on callback to prevent CSRF
- ✅ **Nonce** — verify in ID token to prevent replay attacks
- ✅ **ID token signature** — always verify using JWKS (RS256)
- ✅ **Client secret** — never expose in browser, keep in server-side env
- ✅ **Redirect URI** — must exactly match registered value (nIAM enforces this)
- ✅ **Authorization codes** — single-use (nIAM marks consumed)

---

## References

- **OIDC Provider Implementation:** `elysia_niam/src/app/controllers/sso_Controllers/functions/oidc_provider.ts`
- **OIDC Routes:** `elysia_niam/src/routes/ssoRoute/ssoRoute.ts`
- **System Model (SSO Config):** `elysia_niam/src/app/models/adminEnd/system.ts` (lines 206–240)
- **System Update Logic (client gen):** `elysia_niam/src/app/controllers/systemControllers/functions/editSystem_func.ts`
- **SSO Utils (client gen functions):** `elysia_niam/src/app/controllers/sso_Controllers/functions/sso_utils.ts`
- **SSO Provider Guide:** `elysia_niam/docs/SSO_PROVIDER_QUICK_GUIDE.md`
- **HR App Auth:** `hr-software/src/auth.ts`
- **HR App Login Page:** `hr-software/src/views/login.ts`
- **HR App Routes:** `hr-software/src/index.ts`
