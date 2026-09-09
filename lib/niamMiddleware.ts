/**
 * lib/niamMiddleware.ts — Elysia `beforeHandle` middleware that protects a
 * route with a nIAM workload JWT, verified LOCALLY via cached JWKS.
 *
 * Usage (in a microservice):
 *   .post("/payments/charge", handler, { beforeHandle: [requireScope("payments:charge")] })
 *
 * On success it stamps `ctx.service` with the decoded identity (client_id,
 * scope, tenant, aud) so handlers can log/audit WHO called them.
 * On failure it short-circuits with 401 (no/invalid token) or 403 (scope).
 *
 * makePolicyGuard (below) is the PDP sibling: same local verification, plus a
 * contextual permit/deny from the standalone PDP (nIAM-PDP, guide §8.1).
 */
import { Context } from "elysia";
import { makeJwtVerifier, demoConfig, fetchJson } from "./niam";

// ─── PDP policy guard (opt-in per route; scope routes need none of this) ────
/**
 * Usage:
 *   const guard = makePolicyGuard({ failMode: "closed" });
 *   .post("/payments/refund", handler, { beforeHandle: [guard.requirePolicy("payments", "refund")] })
 *
 * Flow per route: local JWT verify (401/403 semantics unchanged) → PDP decide
 * → permit passes (ctx.service carries identity + decision.obligations) →
 * deny 403 → permit with a "step_up" obligation = 403 + WWW-Authenticate:
 * step_up (the PEP must run the step-up flow before retrying).
 * PDP unreachable: "closed" → 503 (bank default); "open" → local verdict stands.
 */
export const makePolicyGuard = (
  opts: {
    pdpUrl?: string;               // default NIAM_PDP_URL or http://localhost:4200
    failMode?: "open" | "closed";  // default closed
    audience?: string;
    /** Gateway-signed trusted-context JWT provider (env attributes), if any. */
    contextToken?: (ctx: Context) => string | undefined;
  } = {}
) => {
  const pdpUrl = (opts.pdpUrl || process.env.NIAM_PDP_URL || "http://localhost:4200").replace(/\/$/, "");
  const failMode = opts.failMode || "closed";
  const audience = opts.audience ?? demoConfig.audience;
  const verifier = makeJwtVerifier({});

  const requirePolicy = (resource: string, action: string) => async (ctx: Context) => {
    const header = (ctx.headers as any)?.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      ctx.set.status = 401;
      return { success: false, error: "missing bearer token" };
    }
    const token = header.slice("Bearer ".length).trim();
    // 1. Local verify first — same 401/403 semantics as requireScope.
    const { payload, error } = await verifier.verify(token, { audience });
    if (error || !payload) {
      ctx.set.status = 401;
      return { success: false, error: `invalid token: ${error}`, code: "invalid_token" };
    }

    // 2. Contextual decision from the PDP.
    let r: Awaited<ReturnType<typeof fetchJson>>;
    try {
      r = await fetchJson(`${pdpUrl}/v1/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-niam-org": String(payload.tenant || "") },
        body: JSON.stringify({
          subject_token: token,
          resource,
          action,
          context_token: opts.contextToken?.(ctx),
        }),
        timeoutMs: 2000,
      });
    } catch {
      r = { status: 0, ok: false, json: null, text: "pdp unreachable" } as any;
    }

    // Network failure (status 0 = fetch threw) → fail-closed by default.
    // A valid HTTP response (even 403) is a real PDP decision — never treat it as unavailable.
    if (r.status === 0 || !r.json) {
      if (failMode === "open") return; // local verdict stands
      ctx.set.status = 503;
      return { success: false, error: "policy decision point unavailable", code: "pdp_unavailable" };
    }
    if (!r.json.decision) {
      ctx.set.status = 503;
      return { success: false, error: "malformed PDP response", code: "pdp_malformed" };
    }

    const decision = r.json;
    if (decision.decision === "deny") {
      ctx.set.status = 403;
      return { success: false, error: decision.reason || "denied by policy", code: "denied_by_policy" };
    }
    if ((decision.obligations || []).includes("step_up")) {
      ctx.set.status = 403;
      (ctx.set.headers as any)["WWW-Authenticate"] = "step_up";
      return { success: false, error: "step-up authentication required", code: "step_up_required" };
    }

    (ctx as any).service = {
      client_Id: payload.sub,
      scope: payload.scope,
      tenant: payload.tenant,
      aud: payload.aud,
      issuer: payload.iss,
      payload,
      decision, // matched_policy / policy_version — free audit context for handlers
    };
    return;
  };

  return { requirePolicy };
};

export const requireScope = (
  requiredScope: string,
  opts: { audience?: string } = {}
) => {
  // One verifier per protected service (discovery + JWKS cached in-process).
  const verifier = makeJwtVerifier({});
  const audience = opts.audience ?? demoConfig.audience;

  return async (ctx: Context) => {
    const header = (ctx.headers as any)?.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      ctx.set.status = 401;
      return { success: false, error: "missing bearer token" };
    }
    const token = header.slice("Bearer ".length).trim();
    const { payload, error } = await verifier.verify(token, {
      audience,
      requiredScope,
    });
    if (error || !payload) {
      const denied = error?.includes("missing required scope");
      ctx.set.status = denied ? 403 : 401;
      return {
        success: false,
        error: denied ? error : `invalid token: ${error}`,
        code: denied ? "insufficient_scope" : "invalid_token",
      };
    }
    (ctx as any).service = {
      client_Id: payload.sub,
      scope: payload.scope,
      tenant: payload.tenant,
      aud: payload.aud,
      issuer: payload.iss,
      payload,
    };
    return;
  };
};
