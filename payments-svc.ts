/**
 * demo/payments-svc.ts — the RESOURCE SERVER of the microservices demo.
 *
 * payments-svc owns the payments API and demonstrates the DUAL-MODE security
 * posture that matches PingAuthorize:
 *   • /payments/charge and /payments/read: LOCAL scope validation (requireScope)
 *     — zero network calls on the request path, pure JWKS verification.
 *   • /payments/refund: HOT-PATH PDP decision (makePolicyGuard)
 *     — every refund request goes through the standalone PDP service for
 *     contextual, real-time policy evaluation with trusted gateway context.
 *
 * This dual mode is exactly what a banking customer sees: most routes are fast
 * (local scope), high-value routes get contextual policy.
 *
 * Run:  bun run demo:payments          (listens on :4101)
 */
import { Elysia, t } from "elysia";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NiamTokenClient, demoConfig } from "./lib/niam";
import { requireScope, makePolicyGuard } from "./lib/niamMiddleware";

export const PAYMENTS_PORT = Number(process.env.PAYMENTS_PORT || 4101);
const CREDS_FILE = path.join(import.meta.dir, ".demo-credentials.json");

// Trusted-context secret — shared between this PEP and the PDP.
// In production: injected via vault/secret-manager, never in code.
const CONTEXT_SECRET = process.env.NIAM_CONTEXT_SECRET || "niamtest-demo-context-secret";

/**
 * Gateway context signer — simulates an API gateway that attests observed
 * request properties (amount, time, ip, channel) as a signed JWT.
 * The PEP (payments-svc) plays the gateway role in this demo.
 */
const mintContext = (amount: number, extra: Record<string, any> = {}): string => {
  const now = new Date();
  return jwt.sign(
    {
      env: {
        amount,
        time: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
        ip: "127.0.0.1",
        channel: "api",
        ...extra,
      },
      aud: "pdp-api",
      iss: "edge-gateway",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    CONTEXT_SECRET,
    { algorithm: "HS256" }
  );
};

const loadCreds = () => {
  if (!fs.existsSync(CREDS_FILE)) {
    console.error("❌ demo/.demo-credentials.json missing — run `bun run demo:provision` first");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
};

export const buildPaymentsApp = () => {
  const creds = loadCreds();
  const me = creds.services["payments-svc"];
  // payments-svc's OWN identity — used only for the RFC 7662 introspection
  // endpoint below (a resource server may introspect tokens for its API).
  const self = new NiamTokenClient({ client_Id: me.client_Id, client_Secret: me.client_Secret });

  return new Elysia()
    // Public health — no auth (discovery/liveness).
    .get("/payments/health", () => ({
      status: "ok",
      service: "payments-svc",
      protected_routes: [
        "POST /payments/charge — local scope (payments:charge)",
        "POST /payments/refund — hot-path PDP (contextual, trusted gateway)",
        "GET /payments/read — local scope (payments:read)",
      ],
    }))

    // Protected: requires a nIAM JWT carrying scope `payments:charge` and
    // audience `payments-api`. Verified LOCALLY via cached JWKS.
    .post(
      "/payments/charge",
      ({ body, service }: any) => ({
        success: true,
        message: "charge created",
        charge: { id: `ch_${crypto.randomBytes(4).toString("hex")}`, amount: body.amount, currency: body.currency },
        authenticated_as: service.client_Id,
        token_scope: service.scope,
        tenant: service.tenant,
      }),
      { beforeHandle: [requireScope("payments:charge")], body: t.Object({ amount: t.Number(), currency: t.Optional(t.String()) }) }
    )

    // Protected: requires `payments:refund` via HOT-PATH PDP.
    // Every refund request goes through the standalone PDP service for
    // contextual, real-time policy evaluation (banking showcase).
    // Without a trusted context token → PDP denies (untrusted env refused).
    // With context: small refunds permit, large refunds → step_up obligation,
    // large refunds outside business hours → denied.
    .post(
      "/payments/refund",
      ({ body, service }: any) => ({
        success: true,
        message: "refund issued",
        refund: { id: `rf_${crypto.randomBytes(4).toString("hex")}`, amount: body.amount },
        authenticated_as: service.client_Id,
        pdp_decision: service.decision || null,
      }),
      {
        beforeHandle: [
          makePolicyGuard({
            // In production: the API gateway signs the context JWT before the PEP.
            // In this demo: the caller sends x-payment-context (pre-signed by
            // the demo script), or the PEP signs it from the request body.
            contextToken: (ctx: any) => {
              const header = (ctx.headers as any)?.["x-payment-context"];
              if (header) return header; // caller-provided (demo script)
              const amount = ctx.body?.amount ?? 0;
              return mintContext(amount); // PEP self-signs (production-like)
            },
          }).requirePolicy("payments", "refund"),
        ],
        body: t.Object({ amount: t.Number() }),
      }
    )

    // Protected: requires `payments:read`.
    .get(
      "/payments/read",
      ({ service }: any) => ({
        success: true,
        payments: [{ id: "pay_1", amount: 19.99 }],
        authenticated_as: service.client_Id,
      }),
      { beforeHandle: [requireScope("payments:read")] }
    )

    // RFC 7662 introspection demo: payments-svc asks the STS whether a token is
    // still valid. This IS a call to nIAM — but only for this explicit
    // admin-style check, never on the per-request hot path.
    .post(
      "/payments/introspect",
      async ({ body }: any) => {
        const result = await self.introspect(body.token);
        return { introspection: result };
      },
      { body: t.Object({ token: t.String() }) }
    );
};

if (import.meta.main) {
  const app = buildPaymentsApp().listen(PAYMENTS_PORT);
  console.log(`💳 payments-svc running at http://localhost:${app.server?.port}`);
  console.log(`   token audience : ${demoConfig.audience}`);
  console.log(`   validating JWTs locally via JWKS from ${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/jwks\n`);
}
