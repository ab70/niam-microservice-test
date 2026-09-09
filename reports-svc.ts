/**
 * demo/reports-svc.ts — a SIMPLE third microservice (local scope only).
 *
 * reports-svc demonstrates the third pattern in the microservices IAM story:
 *   • A read-only service that protects its routes with local scope validation
 *     (requireScope) — ZERO network calls to nIAM or PDP on the request path.
 *   • It can call payments-svc /payments/read to aggregate data (service-to-service).
 *
 * This is the "many boring services" pattern: most services in a bank don't need
 * contextual policy — they just need local JWT + scope. The hot-path PDP is for
 * high-value routes (payments/refund), not every service.
 *
 * Run:  bun run demo:reports          (listens on :4102)
 */
import { Elysia, t } from "elysia";
import fs from "node:fs";
import path from "node:path";
import { NiamTokenClient, demoConfig } from "./lib/niam";
import { requireScope } from "./lib/niamMiddleware";

export const REPORTS_PORT = Number(process.env.REPORTS_PORT || 4102);
const CREDS_FILE = path.join(import.meta.dir, ".demo-credentials.json");

const loadCreds = () => {
  if (!fs.existsSync(CREDS_FILE)) {
    console.error("❌ demo/.demo-credentials.json missing");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
};

export const buildReportsApp = () => {
  const creds = loadCreds();
  const me = creds.services["reports-svc"];
  const paymentsUrl = (process.env.PAYMENTS_URL || `http://localhost:${process.env.PAYMENTS_PORT || 4101}`).replace(/\/$/, "");
  const self = new NiamTokenClient({ client_Id: me.client_Id, client_Secret: me.client_Secret });

  return new Elysia()
    // Public health — no auth.
    .get("/reports/health", () => ({
      status: "ok",
      service: "reports-svc",
      protected_routes: ["GET /reports/summary — local scope (payments:read)"],
    }))

    // Protected: requires `payments:read` — LOCAL validation only.
    // This is the "many boring services" pattern: local JWKS verification,
    // zero network calls on the hot path. Demonstrates service-to-service
    // data aggregation via local scope enforcement.
    .get(
      "/reports/summary",
      async ({ service }: any) => {
        // Chain: reports-svc calls payments-svc /payments/read with its own token.
        const token = await self.getToken({ scope: "payments:read", audience: demoConfig.audience });
        let paymentsData = null;
        try {
          const r = await fetch(`${paymentsUrl}/payments/read`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(3000),
          });
          paymentsData = await r.json();
        } catch (e: any) {
          paymentsData = { error: e.message };
        }
        return {
          report: "end-of-day summary",
          aggregated_by: service.client_Id,
          payments_data: paymentsData,
        };
      },
      { beforeHandle: [requireScope("payments:read")] }
    );
};

if (import.meta.main) {
  const app = buildReportsApp().listen(REPORTS_PORT);
  console.log(`📊 reports-svc running at http://localhost:${app.server?.port}`);
  console.log(`   validating JWTs locally via JWKS from ${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/jwks`);
  console.log(`   (pure local scope — zero network calls on the request path)\n`);
}
