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
 */
import { Context } from "elysia";
import { makeJwtVerifier, demoConfig } from "./niam";

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
