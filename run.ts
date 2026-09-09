/**
 * demo/run.ts — the one-shot end-to-end demo.
 *
 *   bun run demo:run
 *
 * Steps:
 *   1. ensure the demo service accounts exist (provision if needed),
 *   2. boot payments-svc (:4101) and orders-svc (:4100) in-process,
 *   3. run the full scenario and print a report:
 *        A. happy path      orders → payments (client_credentials + local JWT validation)
 *        B. token claims    what nIAM actually signed into the JWT
 *        C. scope denial    orders tries payments:refund without holding it
 *        D. no credentials  call with no Bearer token
 *        E. tampered token  signature modified → rejected locally
 *        F. introspection   payments-svc asks the STS (RFC 7662)
 *        G. revocation      token revoked → STS says inactive (RFC 7009)
 *        H. token exchange  RFC 8693 delegation (`act` claim)
 *        I. PDP decision    /authz/decision permit for payments:charge
 *        J. PDP decision    /authz/decision deny for payments:refund
 *
 * This project is a PURE CONSUMER of the nIAM STS: it never imports IAM code
 * and talks only over the wire. Prerequisites: the nIAM backend (:4000) must
 * be running, and the service-account credentials must be provisioned
 * (elysia_niam: `bun run demo-provision`).
 */
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { tracedCall, NiamTokenClient, demoConfig, tokenEndpoint, jwksEndpoint } from "./lib/niam";
import { buildPaymentsApp, PAYMENTS_PORT } from "./payments-svc";
import { buildOrdersApp, ORDERS_PORT } from "./orders-svc";

const CYAN = "\x1b[36m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", BOLD = "\x1b[1m", DIM = "\x1b[2m", RESET = "\x1b[0m";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { passed++; console.log(`  ${GREEN}✔${RESET} ${name}${extra ? DIM + " — " + extra + RESET : ""}`); }
  else { failed++; console.log(`  ${RED}✘${RESET} ${name}${extra ? DIM + " — " + extra + RESET : ""}`); }
};
// Section header with a short "what this proves" explanation.
const section = (title: string, why: string) => {
  console.log(`\n  ${BOLD}${title}${RESET}`);
  console.log(`  ${DIM}└ ${why}${RESET}`);
};
// Highlight a notable (but not failing) fact, e.g. auto-detected tenant.
const note = (msg: string) => console.log(`  ${YELLOW}ℹ${RESET} ${DIM}${msg}${RESET}`);

async function main() {
  console.log(`${BOLD}\n  ── nIAM IAM-for-Microservices Demo ──${RESET}\n`);

  // 0. Backend must be up.
  const health = await tracedCall("health check — is the nIAM STS up?", `${demoConfig.baseUrl}/api/health`);
  if (!health.ok) {
    console.error(`${RED}❌ nIAM STS not reachable at ${demoConfig.baseUrl}.${RESET}`);
    console.error(`   Start it first: cd elysia_niam && bun run dev  (or set NIAM_BASE)`);
    process.exit(1);
  }
  console.log(`${GREEN}✔${RESET} nIAM STS reachable at ${demoConfig.baseUrl} (${health.json?.service})`);

  // 1. Credentials must be provisioned by the IAM side (elysia_niam:
  //    `bun run demo-provision`) — this consumer only ever READS them.
  const CREDS_FILE = path.join(import.meta.dir, ".demo-credentials.json");
  if (!fs.existsSync(CREDS_FILE)) {
    console.error(`${RED}❌ .demo-credentials.json missing.${RESET}`);
    console.error(`   Provision the demo accounts from the IAM side first:`);
    console.error(`   cd ../elysia_niam && bun run demo-provision`);
    process.exit(1);
  }
  const saved = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));

  // ── Tenant safety net ──────────────────────────────────────────────────────
  // The credentials file records which tenant the accounts were provisioned
  // into. Auto-detect it so a wrong/default tenant can never silently break
  // every local validation (JWKS lookups are tenant-scoped).
  const credsTenant: string | undefined = saved?.tenant;
  if (credsTenant && credsTenant !== demoConfig.tenant) {
    note(`Tenant auto-detected from ${path.basename(CREDS_FILE)}: "${BOLD}${credsTenant}${RESET}${DIM}" (was defaulting to "${demoConfig.tenant}")`);
    demoConfig.tenant = credsTenant;
    process.env.NIAM_TENANT = credsTenant;
  } else if (credsTenant) {
    note(`Tenant "${credsTenant}" — matches the credentials file`);
  }

  // Verbose run banner: exactly what this demo is targeting.
  console.log(`${DIM}  STS base   : ${demoConfig.baseUrl}${RESET}`);
  console.log(`${DIM}  tenant     : ${BOLD}${demoConfig.tenant}${RESET}`);
  console.log(`${DIM}  audience   : ${demoConfig.audience}${RESET}`);
  console.log(`${DIM}  token URL  : ${tokenEndpoint()}${RESET}`);
  console.log(`${DIM}  jwks URL   : ${jwksEndpoint()}${RESET}`);

  const ordersCreds = saved.services["orders-svc"];
  const sts = new NiamTokenClient({ client_Id: ordersCreds.client_Id, client_Secret: ordersCreds.client_Secret });

  // 2. Boot the two microservices.
  console.log(`\n  ${BOLD}Booting microservices${RESET}`);
  const payments = buildPaymentsApp().listen(PAYMENTS_PORT);
  const paymentsUrl = `http://localhost:${payments.server?.port}`;
  // orders-svc resolves payments-svc through PAYMENTS_URL at build time.
  process.env.PAYMENTS_URL = paymentsUrl;
  const orders = buildOrdersApp().listen(ORDERS_PORT);
  const ordersUrl = `http://localhost:${orders.server?.port}`;
  console.log(`  ${GREEN}✔${RESET} payments-svc on :${payments.server?.port}`);
  console.log(`  ${GREEN}✔${RESET} orders-svc   on :${orders.server?.port}`);
  console.log(`  ${DIM}  (nIAM is NOT on the per-request path — payments-svc validates JWTs locally)${RESET}\n`);

  // ── A. Happy path ──────────────────────────────────────────────────────
  section("A. orders-svc → payments-svc (authenticated call)", "the CALLER gets a JWT from nIAM once, then calls the RESOURCE with Authorization: Bearer <jwt> — no nIAM on the request path");
  const rA = await tracedCall(
    "orders-svc handles the order: nIAM gives it a JWT (client_credentials), then it calls payments-svc with Authorization: Bearer <jwt>",
    `${ordersUrl}/orders/charge`,
    {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: "laptop", amount: 1299.99, currency: "USD" }),
    }
  );
  check("POST /orders/charge returns 200", rA.status === 200, `payments-svc said: ${rA.json?.payments_svc?.message}`);
  check("payments-svc knows WHO called (sub)", rA.json?.payments_svc?.authenticated_as?.startsWith("svc_orders_svc_"), `client: ${rA.json?.payments_svc?.authenticated_as}`);

  // ── B. Token claims ────────────────────────────────────────────────────
  section("B. What nIAM signed into the JWT", "decode the token at the consumer side — iss/aud/scope/tenant prove the STS signed it for THIS tenant and THIS API");
  const tokenB = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const claims: any = jwt.decode(tokenB);
  console.log(`  ${DIM}${JSON.stringify(claims, null, 2)}${RESET}`);
  check("iss is the tenant issuer", String(claims.iss).endsWith(`/t/${demoConfig.tenant}`));
  check("aud = payments-api", claims.aud === demoConfig.audience);
  check("scope = payments:charge", claims.scope === "payments:charge");
  check("client_type = service", claims.client_type === "service");
  check("has jti + exp", !!claims.jti && !!claims.exp && claims.exp - claims.iat === 600);

  // ── C. Scope denial ────────────────────────────────────────────────────
  section("C. Scope enforcement (least privilege)", "orders-svc only holds payments:charge — asking payments-svc for payments:refund must be denied (403), not silently allowed");
  const rC = await tracedCall(
    "orders-svc attempts /orders/refund — it only holds payments:charge, so payments-svc must refuse with 403",
    `${ordersUrl}/orders/refund`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 50 }) }
  );
  check("orders-svc WITHOUT payments:refund is denied 403", rC.status === 200 && rC.json?.payments_svc_status === 403, rC.json?.payments_svc?.error || "");

  // ── D. No credentials ──────────────────────────────────────────────────
  section("D. No credentials at all", "a call with no Authorization header must be rejected with 401 before it reaches the handler");
  const rD = await tracedCall(
    "orders-svc calls payments-svc with NO Authorization header — payments-svc must reject with 401",
    `${ordersUrl}/orders/charge-no-token`,
    { method: "POST" }
  );
  check("no Authorization header → 401", rD.json?.payments_svc_status === 401, rD.json?.payments_svc?.error || "");

  // ── E. Tampered token ──────────────────────────────────────────────────
  section("E. Tampered token (signature integrity)", "flip one byte of the signature — local JWKS verification must reject it (tokens are signed, not just base64-encoded)");
  const tokenE = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const parts = tokenE.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`;
  const rE = await tracedCall(
    "orders-svc presents a TAMPERED token (signature modified) — payments-svc must reject it during local JWKS verification",
    `${paymentsUrl}/payments/charge`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tampered}` }, body: JSON.stringify({ amount: 1 }) }
  );
  check("modified signature → rejected", rE.status === 401, rE.json?.error || "");

  // ── F. Introspection (RFC 7662) ────────────────────────────────────────
  section("F. Introspection — payments-svc asks the STS about a token", "server-side check: the STS confirms the token is active and reveals its claims (a resource server's fallback when it wants the source of truth)");
  const intro = await tracedCall(
    "payments-svc asks the STS (RFC 7662): is this token still active?",
    `${paymentsUrl}/payments/introspect`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tokenB }) }
  );
  check("introspection reports active", intro.json?.introspection?.active === true, `sub: ${intro.json?.introspection?.sub}`);
  check("introspection leaks the scope claim", intro.json?.introspection?.scope === "payments:charge");

  // ── G. Revocation (RFC 7009) ───────────────────────────────────────────
  section("G. Revocation — kill a token before its TTL", "the STS denylists the token's jti — introspection immediately reports inactive, even though the signature is still valid");
  const tokenG = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const before = await sts.introspect(tokenG);
  const rev = await sts.revoke(tokenG);
  const after = await sts.introspect(tokenG);
  check("token was active before revoke", before.active === true);
  check("revoke returns { revoked: true }", rev.revoked === true);
  check("STS now reports the token inactive", after.active === false);
  const rG = await tracedCall(
    "payments-svc validates the REVOKED token locally — stateless validation can't see the denylist, so it still passes until expiry (by design)",
    `${paymentsUrl}/payments/charge`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenG}` }, body: JSON.stringify({ amount: 5 }) }
  );
  console.log(`  ${YELLOW}ℹ${RESET} ${DIM}Local JWT validation still accepts it until expiry (${claims.exp - Math.floor(Date.now()/1000)}s left) — that is by design: stateless validation can't see the denylist. High-security routes call introspection, or check revocation, instead.${RESET}`);

  // ── H. Token exchange (RFC 8693) ───────────────────────────────────────
  section("H. Token exchange — delegation with the `act` claim", "a service swaps its token for a delegated one: sub (who) is preserved, act (who asked) is stamped — the audit trail for on-behalf-of calls");
  const rH = await tracedCall(
    "orders-svc exchanges its token for a DELEGATED one (RFC 8693) and calls payments-svc with it — sub preserved, act=orders-svc",
    `${ordersUrl}/orders/charge-exchanged`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 75 }) }
  );
  check("exchange mints a working token", rH.json?.payments_svc_status === 200, rH.json?.payments_svc?.message || "");
  check("exchanged token preserves sub", rH.json?.exchanged_token?.sub === rH.json?.original_token?.sub);
  check("exchanged token stamps act=orders-svc", rH.json?.exchanged_token?.act?.sub?.startsWith("svc_orders_svc_"), `act: ${JSON.stringify(rH.json?.exchanged_token?.act)}`);

  // ── I–J. The HTTP PDP surface (/authz/decision) ─────────────────────────
  section("I+J. PDP decision over HTTP — permit/deny verdicts", "the PDP asks: may this token do {action} on {resource}? — permit for charge, deny for refund, with subject+tenant in the verdict");
  const rJ = await tracedCall(
    "orders-svc asks the STS PDP (/authz/decision): may my token charge? may it refund?",
    `${ordersUrl}/orders/decision`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
  const dCharge = rJ.json?.decisions?.["payments:charge"];
  const dRefund = rJ.json?.decisions?.["payments:refund"];
  check("PDP permits payments:charge", dCharge?.decision === "permit", `required_scope: ${dCharge?.required_scope}`);
  check("PDP denies payments:refund", dRefund?.decision === "deny", dRefund?.reason || "");
  check("verdicts carry subject + tenant", dCharge?.subject?.startsWith("svc_orders_svc_") && dCharge?.tenant === demoConfig.tenant);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n  ${BOLD}${passed} passed, ${failed} failed${RESET}`);
  console.log(`  ${DIM}key endpoints used (tenant: ${demoConfig.tenant}):${RESET}`);
  console.log(`    ${DIM}token     ${tokenEndpoint()}${RESET}`);
  console.log(`    ${DIM}jwks      ${jwksEndpoint()}${RESET}`);
  console.log(`    ${DIM}introspect ${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/introspect${RESET}`);
  console.log(`    ${DIM}revoke    ${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/revoke${RESET}`);
  console.log(`    ${DIM}pdp       ${demoConfig.baseUrl}/authz/decision${RESET}`);
  console.log(`  ${DIM}verified:${RESET}`);
  console.log(`    ${DIM}· connection       — a service authenticates to nIAM and receives a signed JWT (A, B)${RESET}`);
  console.log(`    ${DIM}· least privilege  — scopes enforced at the resource server (C)${RESET}`);
  console.log(`    ${DIM}· rejection        — no token (D) and tampered tokens (E) rejected locally${RESET}`);
  console.log(`    ${DIM}· lifecycle        — introspection (F) and revocation (G) work at the STS${RESET}`);
  console.log(`    ${DIM}· delegation       — token exchange preserves sub, stamps act (H)${RESET}`);
  console.log(`    ${DIM}· pdp decisions    — permit/deny verdicts from /authz/decision (I–J)${RESET}`);
  console.log(`\n  ${BOLD}IAM for microservices is working — over HTTP.${RESET}\n`);

  payments.stop();
  orders.stop();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(RED + "Demo failed:" + RESET, e); process.exit(1); });
