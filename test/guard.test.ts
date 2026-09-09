/**
 * guard.test.ts — offline unit test for makePolicyGuard (the PEP SDK).
 *
 * Mock main IAM (discovery + JWKS) and mock PDP, then assert the security
 * paths: deny, permit+step_up obligation, clean permit, fail-closed 503 on
 * PDP outage, fail-open passthrough.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const IAM_PORT = 4611, PDP_PORT = 4612;
process.env.NIAM_BASE = `http://localhost:${IAM_PORT}`;
process.env.NIAM_TENANT = "niam-demo";
process.env.NIAM_PDP_URL = `http://localhost:${PDP_PORT}`;

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "guard-test-key";
const pubJwk = { ...(publicKey.export({ format: "jwk" }) as any), kid: KID, alg: "RS256", use: "sig" };

const sign = (scope: string) =>
  jwt.sign(
    { iss: `http://localhost:${IAM_PORT}/t/niam-demo`, sub: "svc_test", scope, tenant: "niam-demo",
      aud: "payments-api", exp: Math.floor(Date.now() / 1000) + 300 },
    privateKey, { algorithm: "RS256", header: { kid: KID } }
  );

// Minimal Elysia-like context for direct middleware invocation.
const makeCtx = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
  set: { status: 0, headers: {} as Record<string, string> },
});

let pdpMode: "deny" | "step_up" | "permit" | "down" = "permit";
let pdpCalls = 0;

const { makePolicyGuard } = await import("../lib/niamMiddleware");

beforeAll(async () => {
  const iam = Bun.serve({
    port: IAM_PORT,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/oauth2/jwks")) return Response.json({ keys: [pubJwk] });
      if (url.pathname.endsWith("/openid-configuration"))
        return Response.json({ issuer: `http://localhost:${IAM_PORT}/t/niam-demo` });
      return new Response("nf", { status: 404 });
    },
  });
  const pdp = Bun.serve({
    port: PDP_PORT,
    fetch: () => {
      pdpCalls++;
      if (pdpMode === "down") return new Response("boom", { status: 500 });
      const body =
        pdpMode === "deny" ? { decision: "deny", reason: "denied by policy 'x'" } :
        pdpMode === "step_up" ? { decision: "permit", obligations: ["step_up"], matched_policy: "refund-guard" } :
        { decision: "permit", matched_policy: "refund-guard" };
      return Response.json(body);
    },
  });
  (globalThis as any).__stopGuardServers = () => { iam.stop(true); pdp.stop(true); };
});

afterAll(() => (globalThis as any).__stopGuardServers?.());

describe("makePolicyGuard", () => {
  const guard = makePolicyGuard({ failMode: "closed" });

  test("deny → 403 with policy reason", async () => {
    pdpMode = "deny";
    const ctx = makeCtx(sign("payments:refund"));
    const res = await guard.requirePolicy("payments", "refund")(ctx as any);
    expect((ctx as any).set.status).toBe(403);
    expect((res as any).error).toContain("denied by policy");
  });

  test("permit + step_up obligation → 403 + WWW-Authenticate: step_up", async () => {
    pdpMode = "step_up";
    const ctx = makeCtx(sign("payments:refund"));
    const res = await guard.requirePolicy("payments", "refund")(ctx as any);
    expect((ctx as any).set.status).toBe(403);
    expect((ctx as any).set.headers["WWW-Authenticate"]).toBe("step_up");
    expect((res as any).code).toBe("step_up_required");
  });

  test("clean permit → passes, ctx.service carries decision context", async () => {
    pdpMode = "permit";
    const ctx = makeCtx(sign("payments:refund"));
    const res = await guard.requirePolicy("payments", "refund")(ctx as any);
    expect(res).toBeUndefined(); // middleware passed
    expect((ctx as any).service.decision.matched_policy).toBe("refund-guard");
  });

  test("PDP down + fail-closed → 503", async () => {
    pdpMode = "down";
    const ctx = makeCtx(sign("payments:refund"));
    const res = await guard.requirePolicy("payments", "refund")(ctx as any);
    expect((ctx as any).set.status).toBe(503);
    expect((res as any).code).toBe("pdp_unavailable");
  });

  test("PDP down + fail-open → local verdict stands (passes)", async () => {
    const openGuard = makePolicyGuard({ failMode: "open" });
    pdpMode = "down";
    const ctx = makeCtx(sign("payments:refund"));
    const res = await openGuard.requirePolicy("payments", "refund")(ctx as any);
    expect(res).toBeUndefined();
  });

  test("invalid token → 401 before the PDP is even called", async () => {
    pdpMode = "permit";
    const callsBefore = pdpCalls;
    const ctx = makeCtx("garbage.token.here");
    await guard.requirePolicy("payments", "refund")(ctx as any);
    expect((ctx as any).set.status).toBe(401);
    expect(pdpCalls).toBe(callsBefore);
  });
});
