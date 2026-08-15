/**
 * lib/niam.ts — shared STS HTTP client for the microservices IAM demo.
 *
 * This is the ONLY piece of code a real nIAM customer would copy into their
 * own services (or wrap as an SDK). It implements the two sides of the story:
 *
 *   1. TOKEN ACQUISITION (the rare path)
 *      A service exchanges its client_id + client_secret for a short-lived
 *      JWT at the STS token endpoint (client_credentials grant, RFC 6749 §4.4).
 *      The token is cached until ~30s before expiry — services must NOT call
 *      the STS on every request.
 *
 *   2. LOCAL VALIDATION (the hot path — nIAM is never on it)
 *      The receiving service validates the Bearer JWT itself, using nIAM's
 *      published public keys (JWKS, RFC 7517). No network call to nIAM per
 *      request: fetch discovery + JWKS once, cache for 10 minutes, refresh
 *      only when an unknown `kid` shows up (i.e. after key rotation).
 *
 * It also wraps RFC 7662 introspection and RFC 7009 revocation so the demo
 * can show what "immediately kill a token" looks like from the STS side.
 */
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { CYAN, GREEN, RED, DIM, RESET, vlog, maskSecrets, summarize } from "./verbose";

// ─── tiny fetch helper ───────────────────────────────────────────────────────
export async function fetchJson(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ status: number; ok: boolean; json: any; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body — leave json null */
    }
    return { status: res.status, ok: res.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

// Verbose trace of ONE HTTP call: why → method URL → body → response.
export async function tracedCall(
  why: string,
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ status: number; ok: boolean; json: any; text: string }> {
  const method = (init?.method || "GET").toUpperCase();
  const bodyShown =
    typeof init?.body === "string" ? maskSecrets(summarize(init.body)) : "";
  vlog(`  ${CYAN}→ ${method} ${url}${RESET}`);
  vlog(`    ${DIM}why : ${why}${RESET}`);
  if (bodyShown) vlog(`    ${DIM}body: ${bodyShown}${RESET}`);
  const r = await fetchJson(url, init);
  const color = r.ok ? GREEN : RED;
  vlog(`  ${color}← ${r.status}${RESET} ${DIM}${maskSecrets(summarize(r.json ?? r.text))}${RESET}`);
  return r;
}

// ─── config ──────────────────────────────────────────────────────────────────
export const demoConfig = {
  // The nIAM STS (Elysia backend) — NOT the frontend. Override per env.
  baseUrl: (process.env.NIAM_BASE || "http://localhost:4000").replace(/\/$/, ""),
  // Tenant database the service accounts live in. Set NIAM_TENANT=<your org DB>
  // to provision into (and see them in) your own nIAM-Frontend org.
  tenant: process.env.NIAM_TENANT || "niam-demo",
  // The API audience the demo services address.
  audience: process.env.NIAM_AUDIENCE || "payments-api",
};

export const tokenEndpoint = () =>
  `${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/token`;
export const jwksEndpoint = () =>
  `${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/jwks`;
export const discoveryEndpoint = () =>
  `${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/.well-known/openid-configuration`;
export const introspectEndpoint = () =>
  `${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/introspect`;
export const revokeEndpoint = () =>
  `${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/revoke`;

export interface ServiceAccountCreds {
  client_Id: string;
  client_Secret?: string;
}

// ─── 1. STS token client ─────────────────────────────────────────────────────
export class NiamTokenClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private cacheKey = "";

  constructor(private creds: ServiceAccountCreds) {}

  /** Exchange client credentials for a signed JWT access token (RFC 6749 §4.4). */
  async getToken(opts?: { scope?: string; audience?: string }): Promise<string> {
    const cacheKey = `${opts?.scope ?? ""}|${opts?.audience ?? ""}`;
    // Reuse the cached token until ~30s before it expires.
    if (this.token && this.cacheKey === cacheKey && this.tokenExpiresAt > Date.now() + 30_000) {
      return this.token;
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.creds.client_Id,
      client_secret: this.creds.client_Secret || "",
    });
    if (opts?.scope) body.set("scope", opts.scope);
    if (opts?.audience) body.set("audience", opts.audience);

    const r = await tracedCall(
      `${this.creds.client_Id} authenticates to the STS and asks for a JWT (client_credentials, RFC 6749 §4.4)`,
      tokenEndpoint(),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );
    if (!r.ok || !r.json?.access_token) {
      throw new Error(`[${this.creds.client_Id}] token request failed (${r.status}): ${r.text}`);
    }
    this.token = r.json.access_token;
    this.cacheKey = cacheKey;
    this.tokenExpiresAt = Date.now() + (r.json.expires_in ?? 600) * 1000;
    return this.token!;
  }

  /**
   * RFC 8693 token exchange: hand the STS a subject token and receive a new
   * token whose `sub` is preserved and whose `act` claim records THIS client
   * as the actor. Scope is narrowed to whatever is requested.
   */
  async exchange(opts: {
    subjectToken: string;
    scope?: string;
    audience?: string;
  }): Promise<{ access_token: string; expires_in: number; scope: string; decoded: jwt.JwtPayload }> {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: this.creds.client_Id,
      client_secret: this.creds.client_Secret || "",
      subject_token: opts.subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    });
    if (opts.scope) body.set("scope", opts.scope);
    if (opts.audience) body.set("audience", opts.audience);

    const r = await tracedCall(
      `${this.creds.client_Id} exchanges its own token for a delegated one (RFC 8693 — keeps sub, stamps act)`,
      tokenEndpoint(),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );
    if (!r.ok || !r.json?.access_token) {
      throw new Error(`[${this.creds.client_Id}] token exchange failed (${r.status}): ${r.text}`);
    }
    return {
      access_token: r.json.access_token,
      expires_in: r.json.expires_in,
      scope: r.json.scope,
      decoded: jwt.decode(r.json.access_token) as jwt.JwtPayload,
    };
  }

  /** RFC 7662 introspection. The caller authenticates as a service account. */
  async introspect(token: string): Promise<any> {
    const body = new URLSearchParams({
      token,
      client_id: this.creds.client_Id,
      client_secret: this.creds.client_Secret || "",
    });
    const r = await tracedCall(
      `${this.creds.client_Id} asks the STS: is this token still active? (introspection, RFC 7662)`,
      introspectEndpoint(),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );
    if (!r.ok) throw new Error(`introspection failed (${r.status}): ${r.text}`);
    return r.json;
  }

  /** RFC 7009 revocation: add the token's jti to the STS denylist. */
  async revoke(token: string): Promise<any> {
    const body = new URLSearchParams({
      token,
      client_id: this.creds.client_Id,
      client_secret: this.creds.client_Secret || "",
    });
    const r = await tracedCall(
      `${this.creds.client_Id} revokes a token before its TTL (RFC 7009 — jti goes on the denylist)`,
      revokeEndpoint(),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );
    if (!r.ok) throw new Error(`revocation failed (${r.status}): ${r.text}`);
    return r.json;
  }
}

// ─── 2. Local JWT verification (the per-request hot path) ───────────────────
/**
 * Builds a verifier that validates nIAM-issued JWTs WITHOUT talking to nIAM:
 * discovery → JWKS (cached 10 min, refreshed on unknown kid) → verify locally.
 *
 * Returns a `verify(token, opts?)` async function that resolves to
 * `{ payload }` on success or `{ error }` on failure — it never throws.
 */
export function makeJwtVerifier(
  opts: { cacheTtlMs?: number; expectedIssuer?: string } = {}
) {
  const cacheTtlMs = opts.cacheTtlMs ?? 10 * 60 * 1000;
  let discovery: any = null;
  let discoveryError: string | null = null;
  let jwks: { keys: any[] } | null = null;
  let jwksFetchedAt = 0;
  const keyCache = new Map<string, crypto.KeyObject>();

  const loadDiscovery = async () => {
    if (discovery) return;
    const r = await fetchJson(discoveryEndpoint());
    if (r.ok && r.json?.issuer) {
      discovery = r.json;
      discoveryError = null;
    } else {
      discoveryError = `discovery failed (${r.status})`;
    }
  };

  const refreshJwks = async (force = false) => {
    if (jwks && !force && Date.now() - jwksFetchedAt < cacheTtlMs) return;
    const r = await fetchJson(jwksEndpoint());
    if (r.ok && Array.isArray(r.json?.keys)) {
      jwks = r.json;
      jwksFetchedAt = Date.now();
    }
  };

  const keyForKid = async (kid?: string): Promise<crypto.KeyObject | undefined> => {
    if (!kid) return undefined;
    if (keyCache.has(kid)) return keyCache.get(kid);
    await refreshJwks();
    const jwk = jwks?.keys.find((k) => k.kid === kid);
    if (!jwk) return undefined;
    try {
      const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
      keyCache.set(kid, key);
      return key;
    } catch {
      return undefined;
    }
  };

  const allowedAlgs = (jwk: any): jwt.Algorithm[] => {
    if (jwk?.alg) return [jwk.alg as jwt.Algorithm];
    return jwk?.kty === "EC" ? ["ES256"] : ["RS256", "ES256"];
  };

  const verify = async (
    token: string,
    vOpts?: { audience?: string; requiredScope?: string; expectedIssuer?: string }
  ): Promise<{ payload?: jwt.JwtPayload; error?: string }> => {
    try {
      await loadDiscovery();
      const decoded = jwt.decode(token, { complete: true }) as any;
      if (!decoded) return { error: "malformed token" };
      const kid = decoded.header?.kid as string | undefined;

      let key = await keyForKid(kid);
      // Unknown kid → the STS may have rotated its signing key; refresh JWKS once.
      if (!key && kid) {
        await refreshJwks(true);
        key = await keyForKid(kid);
      }
      if (!key) return { error: kid ? `signing key not found in JWKS (kid=${kid})` : "token has no kid" };

      const jwk = jwks?.keys.find((k) => k.kid === kid);
      const expectedIssuer =
        vOpts?.expectedIssuer ?? opts.expectedIssuer ?? discovery?.issuer;
      const payload = jwt.verify(token, key, {
        algorithms: allowedAlgs(jwk),
        ...(expectedIssuer ? { issuer: expectedIssuer } : {}),
        ...(vOpts?.audience ? { audience: vOpts.audience } : {}),
      }) as jwt.JwtPayload;

      if (vOpts?.requiredScope) {
        const scopes = new Set(((payload.scope as string) || "").split(" ").filter(Boolean));
        if (!scopes.has(vOpts.requiredScope)) {
          return { error: `missing required scope '${vOpts.requiredScope}' (token has: ${payload.scope})` };
        }
      }
      return { payload };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  };

  return { verify, refreshJwks };
}

export type JwtVerifier = ReturnType<typeof makeJwtVerifier>;
