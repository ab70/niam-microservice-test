/**
 * demo/orders-svc.ts — the CALLER of the microservices demo.
 *
 * orders-svc places orders and calls payments-svc to charge them. It never
 * holds a password for payments-svc — it authenticates itself to nIAM once
 * (client_credentials) and presents the short-lived JWT on every call.
 *
 * Each route here demonstrates one slice of "IAM for microservices":
 *   POST /orders/charge            → happy path: token → call → 200
 *   POST /orders/refund            → orders-svc tries a scope it does NOT have
 *   POST /orders/charge-no-token   → calling with no credentials at all
 *   POST /orders/charge-exchanged  → RFC 8693 token exchange (delegation, `act`)
 *
 * Run:  bun run demo:orders         (listens on :4100)
 */
import { Elysia, t } from "elysia";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { tracedCall, NiamTokenClient, demoConfig } from "./lib/niam";

export const ORDERS_PORT = Number(process.env.ORDERS_PORT || 4100);
const CREDS_FILE = path.join(import.meta.dir, ".demo-credentials.json");

const loadCreds = () => {
  if (!fs.existsSync(CREDS_FILE)) {
    console.error("❌ demo/.demo-credentials.json missing — run `bun run demo:provision` first");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
};

export const buildOrdersApp = () => {
  const creds = loadCreds();
  const me = creds.services["orders-svc"];
  const paymentsUrl = (process.env.PAYMENTS_URL || `http://localhost:${process.env.PAYMENTS_PORT || 4101}`).replace(/\/$/, "");
  // orders-svc's STS identity — the ONLY secret it holds.
  const sts = new NiamTokenClient({ client_Id: me.client_Id, client_Secret: me.client_Secret });

  const callPayments = async (path: string, opts: { why: string; token?: string; body?: any }) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
    return tracedCall(opts.why, `${paymentsUrl}${path}`, {
      method: "POST",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  };

  return new Elysia()
    .get("/orders/health", () => ({ status: "ok", service: "orders-svc" }))

    // Happy path: get a token from nIAM, call payments-svc with it.
    .post(
      "/orders/charge",
      async ({ body }: any) => {
        // ① obtain a JWT from nIAM STS (cached until ~30s before expiry)
        const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
        // ② call payments-svc with the bearer token
        const r = await callPayments("/payments/charge", {
          why: "orders-svc → payments-svc: charge the order, presenting the nIAM JWT it obtained above",
          token,
          body: { amount: body.amount, currency: body.currency },
        });
        return { order: { id: `ord_${Date.now()}`, item: body.item, amount: body.amount }, payments_svc_status: r.status, payments_svc: r.json };
      },
      { body: t.Object({ item: t.String(), amount: t.Number(), currency: t.Optional(t.String()) }) }
    )

    // Attempt a scope orders-svc does NOT have (payments:refund) → 403.
    .post(
      "/orders/refund",
      async ({ body }: any) => {
        const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
        const r = await callPayments("/payments/refund", {
          why: "orders-svc tries to refund WITHOUT holding payments:refund — payments-svc must deny this (403)",
          token,
          body: { amount: body.amount },
        });
        return {
          attempted: "POST /payments/refund with scope=payments:charge only",
          payments_svc_status: r.status,
          payments_svc: r.json,
          verdict: r.status === 403 ? "✅ DENIED as expected — scope enforcement works" : "❌ unexpected — should have been denied",
        };
      },
      { body: t.Object({ amount: t.Number() }) }
    )

    // Call with NO token at all → 401.
    .post(
      "/orders/charge-no-token",
      async () => {
        const r = await callPayments("/payments/charge", {
          why: "orders-svc calls payments-svc with NO Authorization header — payments-svc must reject (401)",
          body: { amount: 5 },
        });
        return {
          attempted: "POST /payments/charge with no Authorization header",
          payments_svc_status: r.status,
          payments_svc: r.json,
          verdict: r.status === 401 ? "✅ REJECTED as expected" : "❌ unexpected",
        };
      }
    )

    // HTTP PDP decision demo: orders-svc asks the STS /authz/decision
    // endpoint whether its token may perform an action. Verdicts
    // (permit/deny + reason) — the canonical wire surface.
    .post(
      "/orders/decision",
      async () => {
        const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
        const decide = async (resource: string, action: string) => {
          const r = await tracedCall(
            `orders-svc asks the STS PDP: may ${resource}:${action}?`,
            `${demoConfig.baseUrl}/authz/decision`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ resource, action }),
            }
          );
          return r.json;
        };
        const charge = await decide("payments", "charge");
        const refund = await decide("payments", "refund");
        return {
          transport: "http (/authz/decision)",
          token_sub: (jwt.decode(token) as any)?.sub,
          decisions: {
            "payments:charge": charge,
            "payments:refund": refund,
          },
        };
      }
    )

    .post(
      "/orders/charge-exchanged",
      async ({ body }: any) => {
        const original = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
        const exchanged = await sts.exchange({
          subjectToken: original,
          scope: "payments:charge",
          audience: demoConfig.audience,
        });
        const r = await callPayments("/payments/charge", {
          why: "orders-svc calls payments-svc with the EXCHANGED (delegated) token — sub preserved, act=orders-svc",
          token: exchanged.access_token,
          body: { amount: body.amount },
        });
        return {
          original_token: { sub: (jwt.decode(original) as any)?.sub, scope: (jwt.decode(original) as any)?.scope },
          exchanged_token: { sub: exchanged.decoded.sub, act: exchanged.decoded.act, scope: exchanged.decoded.scope },
          payments_svc_status: r.status,
          payments_svc: r.json,
        };
      },
      { body: t.Object({ amount: t.Number() }) }
    );
};

if (import.meta.main) {
  const app = buildOrdersApp().listen(ORDERS_PORT);
  console.log(`📦 orders-svc running at http://localhost:${app.server?.port}`);
  console.log(`   calling payments-svc at ${process.env.PAYMENTS_URL || `http://localhost:${process.env.PAYMENTS_PORT || 4101}`}`);
  console.log(`   obtaining tokens from ${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/token\n`);
}
