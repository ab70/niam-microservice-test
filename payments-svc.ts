/**
 * demo/payments-svc.ts — the RESOURCE SERVER of the microservices demo.
 *
 * payments-svc owns the payments API. Every protected route is guarded by the
 * `requireScope` middleware, which:
 *   • fetches nIAM's discovery + JWKS once (cached 10 min),
 *   • verifies the Bearer JWT locally — signature, issuer, audience, expiry —
 *     with ZERO network calls to nIAM on the request path,
 *   • enforces the route's scope (e.g. `payments:charge`).
 *
 * Run:  bun run demo:payments          (listens on :4101)
 */
import { Elysia, t } from "elysia";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NiamTokenClient, demoConfig } from "./lib/niam";
import { NiamGrpcClient } from "./lib/niamGrpc";
import { requireScope } from "./lib/niamMiddleware";

export const PAYMENTS_PORT = Number(process.env.PAYMENTS_PORT || 4101);
const CREDS_FILE = path.join(import.meta.dir, ".demo-credentials.json");

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
  // The same identity over the STS gRPC surface (IAM-side grpcServer, iam.v1).
  const grpc = new NiamGrpcClient({ client_Id: me.client_Id, client_Secret: me.client_Secret });

  return new Elysia()
    // Public health — no auth (discovery/liveness).
    .get("/payments/health", () => ({
      status: "ok",
      service: "payments-svc",
      protected_routes: ["POST /payments/charge (scope: payments:charge)", "POST /payments/refund (scope: payments:refund)", "POST /payments/read (scope: payments:read)"],
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

    // Protected: requires `payments:refund` — orders-svc will be DENIED here
    // because it only holds `payments:charge`.
    .post(
      "/payments/refund",
      ({ body, service }: any) => ({
        success: true,
        message: "refund issued",
        refund: { id: `rf_${crypto.randomBytes(4).toString("hex")}`, amount: body.amount },
        authenticated_as: service.client_Id,
      }),
      { beforeHandle: [requireScope("payments:refund")], body: t.Object({ amount: t.Number() }) }
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
    )

    // gRPC introspection demo (the "internal fast lane"): the same RFC 7662
    // check, but over the typed iam.v1 contract instead of HTTP+JSON. The
    // response is proto-verified (active, scope, client_id, sub, …) — no JSON
    // field-name drift between STS and resource server.
    .post(
      "/payments/grpc-introspect",
      async ({ body }: any) => {
        const result = await grpc.introspect(body.token);
        return { introspection: result, transport: "grpc (iam.v1)" };
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
