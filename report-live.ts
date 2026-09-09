/**
 * demo/report-live.ts — the DUAL-MODE live demo.
 *
 *   bun run demo:report
 *
 * Shows three security postures in one script:
 *   1. LOCAL SCOPE (orders-svc → payments/charge) — zero PDP calls on the hot path
 *   2. HOT-PATH PDP (payments-svc → payments/refund) — every refund request goes
 *      through the standalone PDP for contextual, real-time policy evaluation
 *   3. LOCAL SCOPE (reports-svc → payments/read) — the "many boring services" pattern
 *
 * Prerequisites:
 *   • nIAM backend :4000 running (token issuer)
 *   • nIAM-PDP :4200 running (standalone PDP on Neon)
 *   • .demo-credentials.json provisioned (NIAM_TENANT=niamTest bun run demo-provision-niamtest)
 */
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { tracedCall, NiamTokenClient, demoConfig, tokenEndpoint, jwksEndpoint } from "./lib/niam";
import { buildPaymentsApp, PAYMENTS_PORT } from "./payments-svc";
import { buildReportsApp, REPORTS_PORT } from "./reports-svc";

const CYAN = "\x1b[36m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", BOLD = "\x1b[1m", DIM = "\x1b[2m", RESET = "\x1b[0m";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { passed++; console.log(`  ${GREEN}✔${RESET} ${name}${extra ? DIM + " — " + extra + RESET : ""}`); }
  else { failed++; console.log(`  ${RED}✘${RESET} ${name}${extra ? DIM + " — " + extra + RESET : ""}`); }
};
const section = (title: string, why: string) => {
  console.log(`\n  ${BOLD}${title}${RESET}`);
  console.log(`  ${DIM}└ ${why}${RESET}`);
};
const note = (msg: string) => console.log(`  ${YELLOW}ℹ${RESET} ${DIM}${msg}${RESET}`);

// ─── Trusted-context signer (same as payments-svc uses) ───────────────────
const CONTEXT_SECRET = process.env.NIAM_CONTEXT_SECRET || "niamtest-demo-context-secret";
const mintContext = (env: Record<string, any>): string => {
  return jwt.sign({ env, aud: "pdp-api", iss: "edge-gateway", exp: Math.floor(Date.now() / 1000) + 60 }, CONTEXT_SECRET, { algorithm: "HS256" });
};

async function main() {
  console.log(`${BOLD}\n  ── nIAM Dual-Mode Demo: Local Scope + Hot-Path PDP ──${RESET}\n`);
  console.log(`  ${DIM}This demo shows the PingAuthorize-style architecture:`);
  console.log(`  • orders-svc  → LOCAL scope (zero PDP calls on the hot path)`);
  console.log(`  • payments-svc → HOT-PATH PDP (every refund request goes through the PDP)`);
  console.log(`  • reports-svc  → LOCAL scope (the "many boring services" pattern)${RESET}\n`);

  // 0. Health checks.
  const health = await tracedCall("IAM health", `${demoConfig.baseUrl}/api/health`);
  if (!health.ok) {
    console.error(`${RED}❌ nIAM STS not reachable at ${demoConfig.baseUrl}${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}✔${RESET} nIAM STS reachable (${health.json?.service})`);

  const pdpHealth = await tracedCall("PDP health", `http://localhost:4200/healthz`);
  if (!pdpHealth.ok) {
    console.error(`${RED}❌ nIAM-PDP not reachable at http://localhost:4200 — start it first${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}✔${RESET} nIAM-PDP reachable (${pdpHealth.json?.service})`);

  // 1. Load credentials.
  const CREDS_FILE = path.join(import.meta.dir, ".demo-credentials.json");
  if (!fs.existsSync(CREDS_FILE)) {
    console.error(`${RED}❌ .demo-credentials.json missing${RESET}`);
    console.error(`   cd ../elysia_niam && NIAM_TENANT=niamTest bun run demo-provision-niamtest`);
    process.exit(1);
  }
  const saved = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
  if (saved.tenant !== demoConfig.tenant) {
    note(`Tenant auto-detected: "${saved.tenant}" (was "${demoConfig.tenant}")`);
    demoConfig.tenant = saved.tenant;
    process.env.NIAM_TENANT = saved.tenant;
  }
  console.log(`  ${DIM}STS base   : ${demoConfig.baseUrl}${RESET}`);
  console.log(`  ${DIM}tenant     : ${BOLD}${demoConfig.tenant}${RESET}`);
  console.log(`  ${DIM}audience   : ${demoConfig.audience}${RESET}`);
  console.log(`  ${DIM}token URL  : ${tokenEndpoint()}${RESET}`);
  console.log(`  ${DIM}PDP        : http://localhost:4200${RESET}\n`);

  // 2. Boot microservices in-process.
  console.log(`  ${BOLD}Booting microservices${RESET}`);
  process.env.PAYMENTS_URL = `http://localhost:${PAYMENTS_PORT}`;
  const payments = buildPaymentsApp().listen(PAYMENTS_PORT);
  console.log(`  ${GREEN}✔${RESET} payments-svc on :${payments.server?.port} (hot-path PDP on refund)`);

  const reports = buildReportsApp().listen(REPORTS_PORT);
  console.log(`  ${GREEN}✔${RESET} reports-svc  on :${reports.server?.port} (local scope only)`);

  const paymentsUrl = `http://localhost:${payments.server?.port}`;
  const reportsUrl = `http://localhost:${reports.server?.port}`;
  console.log(`  ${DIM}orders-svc caller ready (not a server — makes HTTP calls to the above)${RESET}\n`);

  // ── Client token mints ──────────────────────────────────────────────────
  const ordersCreds = saved.services["orders-svc"];
  const paymentsCreds = saved.services["payments-svc"];
  const reportsCreds = saved.services["reports-svc"];

  const ordersSts = new NiamTokenClient({ client_Id: ordersCreds.client_Id, client_Secret: ordersCreds.client_Secret });
  const paymentsSts = new NiamTokenClient({ client_Id: paymentsCreds.client_Id, client_Secret: paymentsCreds.client_Secret });
  const reportsSts = new NiamTokenClient({ client_Id: reportsCreds.client_Id, client_Secret: reportsCreds.client_Secret });

  // ══════════════════════════════════════════════════════════════════════════
  // PART 1: LOCAL SCOPE (orders-svc → payments/charge)
  // ══════════════════════════════════════════════════════════════════════════
  section("PART 1: Local scope validation", "orders-svc gets a token from nIAM, validates payments-svc's response locally via JWKS — zero PDP calls");

  const tokenCharge = await ordersSts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const rCharge = await tracedCall(
    "orders-svc → payments/charge with local-scope token",
    `${paymentsUrl}/payments/charge`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenCharge}` }, body: JSON.stringify({ amount: 1299.99, currency: "USD" }) }
  );
  check("payments/charge returns 200 (local scope)", rCharge.status === 200, `amount: $${rCharge.json?.charge?.amount}`);
  check("caller identified (sub)", rCharge.json?.authenticated_as?.startsWith("svc_demo_"), rCharge.json?.authenticated_as);

  // ══════════════════════════════════════════════════════════════════════════
  // PART 2: HOT-PATH PDP (payments-svc → payments/refund)
  // ══════════════════════════════════════════════════════════════════════════
  section("PART 2: Hot-path PDP decision", "every refund request goes through the standalone PDP for contextual, real-time policy — this is the PingAuthorize pattern");

  // 2A: Wrong subject (orders-svc with payments:charge) → deny
  // orders-svc can't even get payments:refund scope (not in its allowed_Scopes).
  // It tries with its payments:charge token — PDP denies because subject not in allowlist.
  const tokenOrders = await ordersSts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const rWrongSubject = await tracedCall(
    "orders-svc (wrong subject) → refund with context",
    `${paymentsUrl}/payments/refund`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenOrders}` }, body: JSON.stringify({ amount: 500 }) }
  );
  check("orders-svc (wrong subject) → 403 denied", rWrongSubject.status === 403, rWrongSubject.json?.error || "");

  // 2B: payments-svc token → refund WITHOUT context (untrusted) → deny
  const tokenPayments = await paymentsSts.getToken({ scope: "payments:refund", audience: demoConfig.audience });
  const rNoContext = await tracedCall(
    "payments-svc (no context token) → refund $500",
    `${paymentsUrl}/payments/refund`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenPayments}` }, body: JSON.stringify({ amount: 500 }) }
  );
  check("payments-svc without context → 403 (trusted context required)", rNoContext.status === 403, rNoContext.json?.error || "");

  // 2C: payments-svc token → refund $500 WITH context → permit
  const ctxOk = mintContext({ amount: 500, time: "10:30" });
  const rPermit = await tracedCall(
    "payments-svc → refund $500 with gateway context",
    `${paymentsUrl}/payments/refund`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenPayments}`, "x-payment-context": ctxOk }, body: JSON.stringify({ amount: 500 }) }
  );
  check("payments-svc + context → 200 permit (small refund, in-hours)", rPermit.status === 200, rPermit.json?.message || "");

  // 2D: payments-svc token → refund $15000 WITH context → step_up
  const ctxBig = mintContext({ amount: 15000, time: "10:30" });
  const rStepUp = await tracedCall(
    "payments-svc → refund $15000 with gateway context",
    `${paymentsUrl}/payments/refund`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenPayments}`, "x-payment-context": ctxBig }, body: JSON.stringify({ amount: 15000 }) }
  );
  check("payments-svc + context + big amount → 403 step_up", rStepUp.status === 403, `code: ${rStepUp.json?.code || ""}`);

  // 2E: payments-svc token → refund $15000 WITH context at 22:30 (after hours) → deny
  const ctxLate = mintContext({ amount: 15000, time: "22:30" });
  const rAfterHours = await tracedCall(
    "payments-svc → refund $15000 with gateway context at 22:30 (after hours)",
    `${paymentsUrl}/payments/refund`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenPayments}`, "x-payment-context": ctxLate }, body: JSON.stringify({ amount: 15000 }) }
  );
  check("payments-svc + context + after-hours → 403 denied", rAfterHours.status === 403, rAfterHours.json?.code || "");

  // ══════════════════════════════════════════════════════════════════════════
  // PART 3: LOCAL SCOPE (reports-svc → payments/read)
  // ══════════════════════════════════════════════════════════════════════════
  section("PART 3: Local scope (reports-svc)", "the 'many boring services' pattern — reports-svc validates locally via JWKS, zero PDP calls");

  const tokenReports = await reportsSts.getToken({ scope: "payments:read", audience: demoConfig.audience });
  const rReports = await tracedCall(
    "reports-svc → /reports/summary (local scope)",
    `${reportsUrl}/reports/summary`,
    { method: "GET", headers: { Authorization: `Bearer ${tokenReports}` } }
  );
  check("reports/summary returns 200 (local scope)", rReports.status === 200, rReports.json?.report || "");

  // Wrong scope → deny
  const tokenWrong = await ordersSts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const rWrongScope = await tracedCall(
    "orders-svc → /reports/summary (wrong scope)",
    `${reportsUrl}/reports/summary`,
    { method: "GET", headers: { Authorization: `Bearer ${tokenWrong}` } }
  );
  check("wrong scope → 403 (local enforcement)", rWrongScope.status === 403, rWrongScope.json?.error || "");

  // ══════════════════════════════════════════════════════════════════════════
  // PART 4: AUDIT TRAIL (checklist #6)
  // ══════════════════════════════════════════════════════════════════════════
  section("PART 4: Audit trail", "every PDP decision is logged — auditors can query who was permitted/denied, by which policy, when");

  const rAudit = await tracedCall(
    "query PDP audit trail",
    `http://localhost:4200/v1/audit?limit=10`,
    { method: "GET", headers: { "x-niam-org": demoConfig.tenant } }
  );
  const auditEntries = rAudit.json?.entries || [];
  check("audit trail has entries", auditEntries.length > 0, `${auditEntries.length} entries`);
  if (auditEntries.length > 0) {
    console.log(`  ${DIM}last ${Math.min(auditEntries.length, 5)} decisions:${RESET}`);
    for (const e of auditEntries.slice(0, 5)) {
      const icon = e.decision === "permit" ? GREEN : RED;
      console.log(`    ${icon}${e.decision}${RESET} ${e.resource}:${e.action} by ${e.subject} — policy: ${e.matchedPolicy || "none"}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n  ${BOLD}${passed} passed, ${failed} failed${RESET}`);
  console.log(`  ${DIM}architecture:${RESET}`);
  console.log(`    ${DIM}· orders-svc  → payments-svc: LOCAL scope (JWKS, zero network)${RESET}`);
  console.log(`    ${DIM}· payments-svc: HOT-PATH PDP on /payments/refund (contextual policy)${RESET}`);
  console.log(`    ${DIM}· reports-svc  → payments-svc: LOCAL scope (JWKS, zero network)${RESET}`);
  console.log(`    ${DIM}· audit trail   → every PDP decision logged in PostgreSQL${RESET}`);
  console.log(`  ${DIM}policy (niamTest):${RESET}`);
  console.log(`    ${DIM}· refunds <= $10k: permit (gateway-attested, business hours)${RESET}`);
  console.log(`    ${DIM}· refunds > $10k: step-up obligation (amount threshold)${RESET}`);
  console.log(`    ${DIM}· refunds outside 09:00-17:00: denied (after-hours)${RESET}`);
  console.log(`    ${DIM}· no context / wrong subject: denied (untrusted env)${RESET}\n`);

  payments.stop();
  reports.stop();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(RED + "Demo failed:" + RESET, e); process.exit(1); });
