/**
 * demo.test.ts — end-to-end proof that nIAM's IAM-for-microservices works for
 * two independent ElysiaJS microservices. This project is a PURE CONSUMER of
 * the nIAM STS: it never imports IAM code and talks only over the wire.
 *
 *   bun test demo.test.ts        (or: bun run demo:test)
 *
 * Prerequisites (IAM side):
 *   • backend on :4000   (elysia_niam: bun run dev)      — override NIAM_BASE
 *   • gRPC surface :50051 (elysia_niam: bun run grpc)     — override GRPC_ADDR
 *   • credentials provisioned (elysia_niam: bun run demo-provision)
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { fetchJson, NiamTokenClient, demoConfig } from "./lib/niam";
import { NiamGrpcClient } from "./lib/niamGrpc";
import { buildPaymentsApp } from "./payments-svc";
import { buildOrdersApp } from "./orders-svc";

let payments: ReturnType<typeof buildPaymentsApp>;
let orders: ReturnType<typeof buildOrdersApp>;
let paymentsUrl = "";
let ordersUrl = "";
let sts: NiamTokenClient;
let creds: any;
let tenantIssuer = "";

beforeAll(async () => {
  const health = await fetchJson(`${demoConfig.baseUrl}/api/health`, {
    timeoutMs: 4000,
  });
  if (!health.ok) {
    throw new Error(
      `nIAM STS not reachable at ${demoConfig.baseUrl}. Start it (cd ../elysia_niam && bun run dev) or set NIAM_BASE.`
    );
  }

  // Credentials must be provisioned IAM-side (bun run demo-provision).
  const CREDS_FILE = path.join(import.meta.dir, ".demo-credentials.json");
  if (!fs.existsSync(CREDS_FILE)) {
    throw new Error(
      `No credentials at ${CREDS_FILE}. Provision them from the IAM side: cd ../elysia_niam && bun run demo-provision`
    );
  }
  creds = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));

  // ── Tenant safety net (same as run.ts) ───────────────────────────────────
  // The credentials file records which tenant the accounts were provisioned
  // into. Auto-detect it so a wrong/default tenant can never silently break
  // every local validation (JWKS lookups are tenant-scoped).
  const credsTenant: string | undefined = creds?.tenant;
  if (credsTenant && credsTenant !== demoConfig.tenant) {
    console.log(`ℹ Tenant auto-detected from ${path.basename(CREDS_FILE)}: "${credsTenant}" (was defaulting to "${demoConfig.tenant}")`);
    demoConfig.tenant = credsTenant;
    process.env.NIAM_TENANT = credsTenant;
  }

  const disc = await fetchJson(`${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/.well-known/openid-configuration`);
  tenantIssuer = disc.json.issuer;
  sts = new NiamTokenClient({
    client_Id: creds.services["orders-svc"].client_Id,
    client_Secret: creds.services["orders-svc"].client_Secret,
  });

  // The gRPC surface runs IAM-side on :50051 (GRPC_ADDR). Probe it up-front
  // with a public GetJWKS call; payments/orders resolve the address from
  // GRPC_ADDR at build time below.
  const probe = new NiamGrpcClient({
    client_Id: creds.services["orders-svc"].client_Id,
    client_Secret: creds.services["orders-svc"].client_Secret,
  });
  try {
    await probe.getJwks(demoConfig.tenant);
    probe.close();
  } catch (e: any) {
    probe.close();
    throw new Error(
      `nIAM gRPC surface not reachable at ${probe.address}. Start it (cd ../elysia_niam && bun run grpc) or set GRPC_ADDR.`
    );
  }

  payments = buildPaymentsApp().listen(0);
  paymentsUrl = `http://localhost:${payments.server?.port}`;
  process.env.PAYMENTS_URL = paymentsUrl;
  orders = buildOrdersApp().listen(0);
  ordersUrl = `http://localhost:${orders.server?.port}`;
});

afterAll(() => {
  payments?.stop();
  orders?.stop();
});

// ─── 1. Connection: STS reachable + tenant issuer resolvable ────────────────
test("STS is reachable and the demo tenant has a discovery document", async () => {
  const r = await fetchJson(`${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/.well-known/openid-configuration`);
  expect(r.status).toBe(200);
  expect(r.json.issuer).toContain(`/t/${demoConfig.tenant}`);
  expect(r.json.grant_types_supported).toContain("client_credentials");
  expect(r.json.token_endpoint_auth_methods_supported).toContain("client_secret_post");
});

// ─── 2. Token issuance (client_credentials, RFC 6749 §4.4) ──────────────────
test("orders-svc obtains a signed JWT from the STS", async () => {
  const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const claims: any = jwt.decode(token);
  expect(claims.sub).toMatch(/^svc_orders_svc_/);
  expect(claims.iss).toBe(tenantIssuer); // matches the discovery document
  expect(claims.aud).toBe(demoConfig.audience);
  expect(claims.scope).toBe("payments:charge");
  expect(claims.tenant).toBe(demoConfig.tenant);
  expect(claims.client_type).toBe("service");
  expect(claims.exp - claims.iat).toBe(600);
  expect(claims.jti).toBeTruthy();
});

test("a bad client secret is rejected (401 invalid_client)", async () => {
  const r = await fetchJson(`${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.services["orders-svc"].client_Id,
      client_secret: "definitely-wrong",
    }).toString(),
  });
  expect(r.status).toBe(401);
  expect(r.json.error).toBe("invalid_client");
});

// ─── 3. Communication: orders → payments with local JWT validation ──────────
test("orders-svc calls payments-svc and payments-svc validates LOCALLY", async () => {
  const r = await fetchJson(`${ordersUrl}/orders/charge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: "monitor", amount: 249.99 }),
  });
  expect(r.status).toBe(200);
  expect(r.json.payments_svc_status).toBe(200);
  expect(r.json.payments_svc.success).toBe(true);
  // payments-svc must know the caller's workload identity:
  expect(r.json.payments_svc.authenticated_as).toMatch(/^svc_orders_svc_/);
  expect(r.json.payments_svc.token_scope).toBe("payments:charge");
});

test("payments-svc validates the token against the tenant JWKS (no STS call on hot path)", async () => {
  // Grab the exact token orders-svc would present and confirm the kid is in
  // the tenant JWKS — that is the key the validator uses locally.
  const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const kid = (jwt.decode(token, { complete: true }) as any).header.kid;
  const jwks = await fetchJson(`${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/jwks`);
  expect(jwks.json.keys.map((k: any) => k.kid)).toContain(kid);
});

// ─── 4. Scope enforcement ───────────────────────────────────────────────────
test("orders-svc is DENIED payments:refund (403 insufficient_scope)", async () => {
  const r = await fetchJson(`${ordersUrl}/orders/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 50 }),
  });
  expect(r.json.payments_svc_status).toBe(403);
  expect(r.json.verdict).toContain("DENIED");
});

test("calling with no credentials is rejected (401)", async () => {
  const r = await fetchJson(`${ordersUrl}/orders/charge-no-token`, { method: "POST" });
  expect(r.json.payments_svc_status).toBe(401);
});

test("a tampered token is rejected by local validation (401)", async () => {
  const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`;
  const r = await fetchJson(`${paymentsUrl}/payments/charge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tampered}` },
    body: JSON.stringify({ amount: 1 }),
  });
  expect(r.status).toBe(401);
});

// ─── 5. Introspection (RFC 7662) ────────────────────────────────────────────
test("payments-svc can introspect a token for its API (active: true)", async () => {
  const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const r = await fetchJson(`${paymentsUrl}/payments/introspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(r.json.introspection.active).toBe(true);
  expect(r.json.introspection.sub).toMatch(/^svc_orders_svc_/);
  expect(r.json.introspection.scope).toBe("payments:charge");
});

// ─── 6. Revocation (RFC 7009) ───────────────────────────────────────────────
test("revoking a token makes introspection report inactive immediately", async () => {
  const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  expect((await sts.introspect(token)).active).toBe(true);
  const rev = await sts.revoke(token);
  expect(rev.revoked).toBe(true);
  expect((await sts.introspect(token)).active).toBe(false);
});

// ─── 7. Token exchange (RFC 8693) ───────────────────────────────────────────
test("orders-svc can delegate with a token exchange (act claim, sub preserved)", async () => {
  const r = await fetchJson(`${ordersUrl}/orders/charge-exchanged`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 75 }),
  });
  expect(r.status).toBe(200);
  expect(r.json.payments_svc_status).toBe(200);
  expect(r.json.exchanged_token.sub).toBe(r.json.original_token.sub);
  expect(r.json.exchanged_token.act.sub).toMatch(/^svc_orders_svc_/);
  expect(r.json.exchanged_token.scope).toBe("payments:charge");
});

// ─── 8. The gRPC surface (additive "internal fast lane", iam.v1) ───────────
test("gRPC introspection is the typed twin of RFC 7662 (active + claims)", async () => {
  // Fresh client: the revocation test above revokes the shared cached token,
  // so a new token (not the revoked one) proves the happy path.
  const fresh = new NiamTokenClient({
    client_Id: creds.services["orders-svc"].client_Id,
    client_Secret: creds.services["orders-svc"].client_Secret,
  });
  const token = await fresh.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const r = await fetchJson(`${paymentsUrl}/payments/grpc-introspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(r.json.transport).toBe("grpc (iam.v1)");
  expect(r.json.introspection.active).toBe(true);
  expect(r.json.introspection.sub).toMatch(/^svc_orders_svc_/);
  expect(r.json.introspection.scope).toBe("payments:charge");
  expect(r.json.introspection.tenant).toBe(demoConfig.tenant);
  expect(r.json.introspection.exp).toBeTruthy();
});

test("gRPC introspection rejects a caller that cannot authenticate (UNAUTHENTICATED)", async () => {
  const token = await sts.getToken({ scope: "payments:charge", audience: demoConfig.audience });
  const imposter = new NiamGrpcClient({
    client_Id: "svc_imposter_0000",
    client_Secret: "not-a-real-secret",
  });
  try {
    await imposter.introspect(token);
    expect.unreachable("imposter should not introspect");
  } catch (err: any) {
    expect(err.code).toBe(16); // grpc.status.UNAUTHENTICATED
  } finally {
    imposter.close();
  }
});

test("gRPC Decide is the typed PDP: permit charge, deny refund, carries subject/tenant", async () => {
  const r = await fetchJson(`${ordersUrl}/orders/grpc-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(r.json.transport).toBe("grpc (iam.v1)");
  const charge = r.json.decisions["payments:charge"];
  const refund = r.json.decisions["payments:refund"];
  expect(charge.decision).toBe("permit");
  expect(charge.required_scope).toBe("payments:charge");
  expect(charge.subject).toMatch(/^svc_orders_svc_/);
  expect(charge.tenant).toBe(demoConfig.tenant);
  expect(refund.decision).toBe("deny");
  expect(refund.reason).toContain("payments:refund");
});

test("gRPC GetJWKS returns the same signing keys as the HTTP JWKS", async () => {
  const grpcClient = new NiamGrpcClient({
    client_Id: creds.services["orders-svc"].client_Id,
    client_Secret: creds.services["orders-svc"].client_Secret,
  });
  const grpcJwks = await grpcClient.getJwks(demoConfig.tenant);
  grpcClient.close();
  const httpJwks = await fetchJson(
    `${demoConfig.baseUrl}/t/${demoConfig.tenant}/oauth2/jwks`
  );
  const kids = (keys: any[]) => keys.map((k: any) => k.kid).sort();
  expect(kids(grpcJwks.keys)).toEqual(kids(httpJwks.json.keys));
  expect(grpcJwks.keys[0].kid).toBeTruthy();
  expect(grpcJwks.keys[0].kty).toBeTruthy();
  expect(grpcJwks.keys[0].json).toBeTruthy();
});
