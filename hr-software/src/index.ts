import { Elysia } from "elysia";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Resolve relative to this file (import.meta.dir), not the process cwd, so the
// app runs from any working directory (e.g. `bun run --cwd hr-software dev`).
const niamLogoPath = path.join(import.meta.dir, "..", "public", "niamofficiallogo.png");
const niamLogoBuffer = readFileSync(niamLogoPath);

function html(content: string): Response {
  return new Response(content, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
import { cookie } from "@elysiajs/cookie";
import { db } from "./db";
import { createSession, destroySession, getSessionUser, extractToken } from "./auth";
import { loginPage } from "./views/login";
import { dashboardPage } from "./views/dashboard";
import { staffDashboardPage } from "./views/staffDashboard";
import { errorPage } from "./views/error";
import { pushStaffToNiamLogger } from "./sync";
import xlsx from "xlsx";

// ── NIAM OIDC SSO Configuration (from ASDF system config) ───────────
const NIAM_OIDC_ISSUER = process.env.NIAM_OIDC_ISSUER || "http://localhost:3000/api/sso/oidc";
const NIAM_CLIENT_ID = process.env.NIAM_CLIENT_ID || "client_6a4f4d91c4516b2756055390_766634";
const NIAM_CLIENT_SECRET = process.env.NIAM_CLIENT_SECRET || "c21c01838cbd056be8675bd07ef6b466cf2dd7029a4c825317e4db23824a6cb3";
const NIAM_REDIRECT_URI = process.env.NIAM_REDIRECT_URI || "http://localhost:3456/callback";
const NIAM_DB = process.env.NIAM_DB || "niamTest";

// ── Staff field columns (matches the niam-logger SyncUserList shape) ──
const STAFF_COLUMNS = [
  "firstName", "lastName", "nick_Name", "email", "phone", "address",
  "employee_Id", "uid", "office", "joining_Date", "effective_Date",
  "division", "designation", "band", "position", "department",
  "section", "sub_Section", "unit", "supervisor", "supervisorName",
];

// ── Helper: get all staff ────────────────────────────────────────────
function getAllStaff(): any[] {
  return db.query("SELECT * FROM staff ORDER BY id DESC").all();
}

// ── Helper: resolve user from request ────────────────────────────────
function resolveUser(req: any) {
  const cookieHeader = req.headers?.get?.('cookie') ?? req.headers?.cookie ?? null;
  const token = extractToken(cookieHeader);
  return getSessionUser(token);
}

const app = new Elysia()
  .use(cookie())

  // ─── Static: nIAM logo ────────────────────────────────────────
  .get("/niamofficiallogo.png", () => {
    return new Response(niamLogoBuffer, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  })

  // ─── Public: Login page ─────────────────────────────────────────
  .get("/", ({ redirect }) => {
    console.log("[route GET /] redirecting to /login");
    return redirect("/login");
  })

  .get("/login", ({ request }) => {
    console.log("[route GET /login] hit");
    const user = resolveUser(request);
    console.log("[route GET /login] already-authed user:", user ? user.email : null);
    if (user) {
      if (user.role === 'staff') {
        return html(staffDashboardPage(user));
      }
      return html(dashboardPage(user, getAllStaff()));
    }
    return html(loginPage());
  })

  .post("/login", async ({ body }) => {
    console.log("[route POST /login] raw body:", JSON.stringify(body));
    const { email, password } = body as { email: string; password: string };

    console.log("[route POST /login] email:", email, "| password length:", password?.length);

    const user = db
      .query("SELECT id, email, password, firstName FROM users WHERE email = ? AND active = 1")
      .get(email) as any;

    console.log("[route POST /login] db user found:", user ? `id=${user.id} email=${user.email}` : null);

    if (!user || user.password !== password) {
      console.log("[route POST /login] ❌ auth failed — user?", !!user, "| password match?", !!user && user.password === password);
      return html(loginPage("Invalid email or password"));
    }

    const token = createSession(user.id, "admin");
    console.log("[route POST /login] ✅ auth ok — created token:", token.slice(0, 8) + "…", "for userId:", user.id, "type: admin");
    const cookieValue = `session=${token}; Path=/; HttpOnly; Max-Age=86400`;

    console.log("[route POST /login] ➡️ 302 redirect to /dashboard, Set-Cookie:", cookieValue);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/dashboard",
        "Set-Cookie": cookieValue,
      },
    });
  })

  .get("/logout", ({ cookie: { session }, redirect }) => {
    const token = session.value;
    if (token) destroySession(token);
    session.remove();
    return redirect("/login");
  })

  // ─── Protected: Dashboard ───────────────────────────────────────
  .get("/dashboard", ({ request, redirect }) => {
    console.log("[route GET /dashboard] hit, cookie header:", request.headers.get?.("cookie") ?? request.headers?.cookie ?? "(none)");
    const user = resolveUser(request);
    console.log("[route GET /dashboard] resolved user:", user ? user.email : null);
    if (!user) {
      console.log("[route GET /dashboard] ❌ no user — redirect to /login");
      return redirect("/login");
    }
    console.log("[route GET /dashboard] ✅ serving dashboard for", user.email, "role:", user.role);
    if (user.role === 'staff') {
      return html(staffDashboardPage(user));
    }
    return html(dashboardPage(user, getAllStaff()));
  })

  // ─── Protected: Add Staff ───────────────────────────────────────
  .post("/staff/add", async ({ request, body, redirect }) => {
    const user = resolveUser(request);
    if (!user) return redirect("/login");

    const data = body as Record<string, string>;

    if (!data.email || !data.firstName || !data.lastName) {
      return redirect("/dashboard");
    }

    // Auto-generate email if not provided (but we require it from form)
    const fields = STAFF_COLUMNS;
    const values = fields.map((f) => data[f] || "");

    const placeholders = fields.map(() => "?").join(", ");
    const colNames = fields.join(", ");

    try {
      db.query(`INSERT INTO staff (${colNames}) VALUES (${placeholders})`).run(...values);

      // Push to niam-logger
      const staffPayload: any = {};
      fields.forEach((f, i) => {
        if (values[i]) staffPayload[f] = values[i];
      });
      pushStaffToNiamLogger([staffPayload]);
    } catch (err: any) {
      console.error("[staff/add] error:", err.message);
    }

    return redirect("/dashboard");
  })

  // ─── Protected: Excel Upload ────────────────────────────────────
  .post("/staff/upload", async ({ request, redirect }) => {
    const user = resolveUser(request);
    if (!user) return redirect("/login");

    try {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) return redirect("/dashboard");

      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = xlsx.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json<Record<string, string>>(sheet);

      let added = 0;
      let skipped = 0;
      const insertedStaff: any[] = [];

      for (const row of rows) {
        const email = row.email?.trim();
        if (!email) { skipped++; continue; }

        // Check for duplicate
        const existing = db.query("SELECT id FROM staff WHERE email = ?").get(email);
        if (existing) { skipped++; continue; }

        const fields = STAFF_COLUMNS;
        const values = fields.map((f) => row[f] || row[f?.toLowerCase()] || "");
        const placeholders = fields.map(() => "?").join(", ");
        const colNames = fields.join(", ");

        try {
          db.query(`INSERT INTO staff (${colNames}) VALUES (${placeholders})`).run(...values);
          // Collect the actual row that was inserted
          const staffObj: any = { email };
          fields.forEach((f, i) => { if (values[i]) staffObj[f] = values[i]; });
          insertedStaff.push(staffObj);
          added++;
        } catch {
          skipped++;
        }
      }

      // Push only the actually-inserted staff to niam-logger
      if (insertedStaff.length > 0) {
        pushStaffToNiamLogger(insertedStaff);
      }

      console.log(`[upload] Added: ${added}, Skipped: ${skipped}`);
    } catch (err: any) {
      console.error("[upload] error:", err.message);
    }

    return redirect("/dashboard");
  })

  // ─── Protected: Edit Staff ───────────────────────────────────────
  .post("/staff/edit/:id", async ({ request, params, body, redirect }) => {
    const user = resolveUser(request);
    if (!user) return redirect("/login");

    const id = Number(params.id);
    if (!Number.isFinite(id)) return redirect("/dashboard");

    const data = body as Record<string, string>;
    const fields = STAFF_COLUMNS;

    const existing = db.query("SELECT id, email FROM staff WHERE id = ?").get(id) as any;
    if (!existing) return redirect("/dashboard");

    const setClause = fields.map((f) => `${f} = ?`).join(", ");
    const values = fields.map((f) => data[f] || "");
    const active = data.active === "1" || data.active === "true" || data.active === "on" ? 1 : 0;

    try {
      db.query(`UPDATE staff SET ${setClause}, active = ?, updatedAt = datetime('now') WHERE id = ?`)
        .run(...values, active, id);

      // Push UPDATE to niam-logger
      const staffPayload: any = { email: existing.email };
      fields.forEach((f, i) => {
        if (values[i]) staffPayload[f] = values[i];
      });
      pushStaffToNiamLogger([staffPayload], "UPDATE");
    } catch (err: any) {
      console.error("[staff/edit] error:", err.message);
    }

    return redirect("/dashboard");
  })

  // ─── Protected: Delete Staff ─────────────────────────────────────
  .post("/staff/delete/:id", async ({ request, params, redirect }) => {
    const user = resolveUser(request);
    if (!user) return redirect("/login");

    const id = Number(params.id);
    if (Number.isFinite(id)) {
      // Get email before delete for sync
      const existing = db.query("SELECT id, email FROM staff WHERE id = ?").get(id) as any;

      try {
        db.query("DELETE FROM staff WHERE id = ?").run(id);

        // Push REMOVE to niam-logger
        if (existing?.email) {
          pushStaffToNiamLogger([{ email: existing.email }], "REMOVE");
        }
      } catch (err: any) {
        console.error("[staff/delete] error:", err.message);
      }
    }

    return redirect("/dashboard");
  })

  // ─── SSO: Login with NIAM (redirects to nIAM OIDC authorize) ──
  .get("/auth/niam/login", () => {
    console.log("[SSO] ===== NIAM LOGIN INITIATED =====");
    
    // Generate PKCE challenge
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("base64url");
    const nonce = crypto.randomBytes(16).toString("base64url");

    console.log("[SSO] Generated PKCE: verifier=" + codeVerifier.slice(0, 12) + "... challenge=" + codeChallenge.slice(0, 12) + "...");
    console.log("[SSO] Generated state=" + state.slice(0, 12) + "... nonce=" + nonce.slice(0, 12) + "...");
    console.log("[SSO] Client ID: " + NIAM_CLIENT_ID);
    console.log("[SSO] Redirect URI: " + NIAM_REDIRECT_URI);
    console.log("[SSO] Issuer: " + NIAM_OIDC_ISSUER);

    const params = new URLSearchParams({
      client_id: NIAM_CLIENT_ID,
      redirect_uri: NIAM_REDIRECT_URI,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authorizeUrl = `${NIAM_OIDC_ISSUER}/authorize?${params.toString()}`;
    console.log("[SSO] ➡️ Redirecting browser to nIAM authorize URL:");
    console.log("[SSO] " + authorizeUrl);

    console.log("[SSO] 🍪 Setting 3 cookies: niam_state, niam_nonce, niam_verifier");

    // ⚠️ Must use Headers.append() for multiple Set-Cookie — arrays get comma-joined (breaks RFC 6265)
    const redirectHeaders = new Headers();
    redirectHeaders.set("Location", authorizeUrl);
    redirectHeaders.append("Set-Cookie", `niam_state=${state}; Path=/; HttpOnly; Max-Age=600`);
    redirectHeaders.append("Set-Cookie", `niam_nonce=${nonce}; Path=/; HttpOnly; Max-Age=600`);
    redirectHeaders.append("Set-Cookie", `niam_verifier=${codeVerifier}; Path=/; HttpOnly; Max-Age=600`);

    return new Response(null, {
      status: 302,
      headers: redirectHeaders,
    });
  })

  // ─── SSO: OIDC Callback (after nIAM auth) ──────────────────────
  .get("/callback", async ({ query, set, redirect, request }) => {
    const { code, state, error, error_description } = query as { code?: string; state?: string; error?: string; error_description?: string };

    console.log("[SSO] ===== CALLBACK INVOKED =====");
    console.log("[SSO] Query params received: code=" + (code ? code.slice(0, 12) + "..." : "❌ MISSING") + " state=" + (state ? state.slice(0, 12) + "..." : "❌ MISSING") + " error=" + (error || "⛔ none"));

    // ── Handle OIDC error redirect (e.g. access denied, invalid request) ──
    if (error) {
      console.warn("[SSO] ❌ OIDC authorization error: " + error + " — " + (error_description || "no description"));
      return html(errorPage(
        "Access Denied",
        error_description || "Authentication was denied by the identity provider. Please contact your administrator if you believe this is an error."
      ));
    }

    // Extract cookies manually from request
    const cookieHeader = request.headers.get("cookie") || "";
    console.log("[SSO] Raw Cookie header: " + (cookieHeader ? cookieHeader.slice(0, 120) + "..." : "(empty)"));
    
    const getCookie = (name: string) => {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
      return match?.[1];
    };

    const storedState = getCookie("niam_state");
    const storedNonce = getCookie("niam_nonce");
    const storedVerifier = getCookie("niam_verifier");

    console.log("[SSO] Cookies extracted: niam_state=" + (storedState ? storedState.slice(0, 12) + "..." : "❌ MISSING"));
    console.log("[SSO] Cookies extracted: niam_nonce=" + (storedNonce ? storedNonce.slice(0, 12) + "..." : "❌ MISSING"));
    console.log("[SSO] Cookies extracted: niam_verifier=" + (storedVerifier ? storedVerifier.slice(0, 12) + "..." : "❌ MISSING"));

    // Verify state
    if (!state || state !== storedState) {
      console.warn(`[SSO] ❌ State mismatch — possible CSRF (got query state: ${state?.slice(0,12)}..., expected cookie state: ${storedState?.slice(0,12)}...)`);
      return redirect("/login?error=state_mismatch");
    }
    console.log("[SSO] ✅ State verified OK");

    if (!code || !storedVerifier) {
      console.warn("[SSO] ❌ Missing params — code=" + !!code + " verifier=" + !!storedVerifier);
      return redirect("/login?error=missing_params");
    }
    console.log("[SSO] ✅ Code and verifier present");

    try {
      // Exchange code for tokens
      console.log("[SSO] ===== TOKEN EXCHANGE =====");
      console.log("[SSO] POSTing to token endpoint: " + NIAM_OIDC_ISSUER + "/token");
      
      console.log("[SSO] Token request body (sanitized): " + JSON.stringify({
        grant_type: "authorization_code",
        code: code?.slice(0, 12) + "...",
        client_secret: NIAM_CLIENT_SECRET ? NIAM_CLIENT_SECRET.slice(0, 8) + "..." : "❌ MISSING",
        code_verifier: storedVerifier ? storedVerifier.slice(0, 12) + "..." : "❌ MISSING",
        db: NIAM_DB,
      }));
      
      const tokenResponse = await fetch(`${NIAM_OIDC_ISSUER}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: NIAM_REDIRECT_URI,
          client_id: NIAM_CLIENT_ID,
          client_secret: NIAM_CLIENT_SECRET,
          code_verifier: storedVerifier,
          db: NIAM_DB,
        }),
      });

      console.log("[SSO] Token response status: " + tokenResponse.status + " " + tokenResponse.statusText);
      
      const tokens = await tokenResponse.json();
      console.log("[SSO] Token response body (sanitized): has_id_token=" + !!tokens.id_token + " has_access_token=" + !!tokens.access_token + " expires_in=" + tokens.expires_in);

      if (!tokenResponse.ok || !tokens.id_token) {
        console.error("[SSO] ❌ Token exchange FAILED — status=" + tokenResponse.status + " body=" + JSON.stringify(tokens));
        
        // Check if error is related to user entitlement/not found
        const errorMessage = tokens.error || tokens.message || "";
        const isEntitlementError = 
          errorMessage.toLowerCase().includes("not entitled") ||
          errorMessage.toLowerCase().includes("user not found") ||
          errorMessage.toLowerCase().includes("access denied") ||
          errorMessage.toLowerCase().includes("unauthorized client") ||
          tokenResponse.status === 403 ||
          tokenResponse.status === 401;
        
        if (isEntitlementError) {
          console.log("[SSO] Showing entitlement error page to user");
          return html(errorPage(
            "Access Denied",
            "You are not entitled to access this application. Your account may not be configured for SSO access or you may not have the required permissions."
          ));
        }
        
        return redirect("/login?error=token_exchange_failed");
      }
      console.log("[SSO] ✅ Token exchange succeeded");

      // Decode the ID token (JWT) payload
      console.log("[SSO] ===== DECODING ID TOKEN =====");
      const idTokenParts = tokens.id_token.split(".");
      console.log("[SSO] ID token parts count: " + idTokenParts.length + " (expected 3 for valid JWT)");
      if (idTokenParts.length !== 3) {
        return redirect("/login?error=invalid_id_token");
      }

      const claims = JSON.parse(
        Buffer.from(idTokenParts[1], "base64url").toString("utf8")
      );

      console.log("[SSO] ID Token claims:", JSON.stringify(claims));

      // Verify nonce
      if (storedNonce && claims.nonce !== storedNonce) {
        console.warn(`[SSO] Nonce mismatch — replay attack? (got: ${claims.nonce})`);
        return redirect("/login?error=nonce_mismatch");
      }

      // Verify issuer
      if (claims.iss !== NIAM_OIDC_ISSUER) {
        console.warn(`[SSO] Issuer mismatch: ${claims.iss} !== ${NIAM_OIDC_ISSUER}`);
        return redirect("/login?error=issuer_mismatch");
      }

      // Find or create staffUser record
      const email = claims.email;
      const givenName = claims.given_name || claims.name || email?.split("@")[0] || "User";
      const familyName = claims.family_name || "";

      if (!email) {
        return redirect("/login?error=no_email");
      }

      // Find existing staffUser (including inactive — we'll reactivate below)
      let staffUserRecord: any = db
        .query("SELECT id, email, firstName, active FROM staffUser WHERE email = ?")
        .get(email);

      if (staffUserRecord) {
        // Record exists — reactivate if it was deactivated
        if (staffUserRecord.active !== 1) {
          db.query("UPDATE staffUser SET active = 1, updatedAt = datetime('now') WHERE email = ?")
            .run(email);
          console.log(`[SSO] 🔄 Reactivated deactivated staffUser: ${email}`);
        }
        console.log(`[SSO] staffUser exists: ${email} (id=${staffUserRecord.id})`);
      } else {
        // No record — create fresh
        db.query(`
          INSERT INTO staffUser (email, username, firstName, lastName, department, source, active, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, 'SSO', 'nIAM', 1, datetime('now'), datetime('now'))
        `).run(
          email,
          email.split("@")[0],
          givenName,
          familyName
        );
        staffUserRecord = db
          .query("SELECT id, email, firstName FROM staffUser WHERE email = ?")
          .get(email) as any;
        console.log(`[SSO] ✅ Created staffUser from SSO: ${email}`);
      }

      // Create local session (same session store as admin)
      const sessionToken = createSession(staffUserRecord.id, "staff");

      console.log(`[SSO] ✅ Login successful for ${email}, redirecting to dashboard`);

      // ⚠️ Must use Headers.append() for multiple Set-Cookie — commas break RFC 6265
      const callbackHeaders = new Headers();
      callbackHeaders.set("Location", "/dashboard");
      callbackHeaders.append("Set-Cookie", `niam_state=; Path=/; HttpOnly; Max-Age=0`);
      callbackHeaders.append("Set-Cookie", `niam_nonce=; Path=/; HttpOnly; Max-Age=0`);
      callbackHeaders.append("Set-Cookie", `niam_verifier=; Path=/; HttpOnly; Max-Age=0`);
      callbackHeaders.append("Set-Cookie", `session=${sessionToken}; Path=/; HttpOnly; Max-Age=86400`);

      return new Response(null, {
        status: 302,
        headers: callbackHeaders,
      });
    } catch (err: any) {
      console.error("[SSO] Callback error:", err.message);
      return redirect("/login?error=callback_error");
    }
  })

  .get("/api/staff", () => {
    return getAllStaff();
  })

  .post("/api/webhook", async ({ body, headers, set }) => {
    const HR_AUTH_TOKEN = "458yyu9865.iourtes";
    const authHeader = headers["x-hr-auth"];

    if (authHeader !== HR_AUTH_TOKEN) {
      console.warn(`[webhook] ❌ Auth failed — x-hr-auth header mismatch (received: "${authHeader}")`);
      set.status = 401;
      return { success: false, message: "Unauthorized: invalid x-hr-auth token" };
    }

    const data = body as Record<string, string>;
    console.log("[webhook POST /api/webhook] ✅ Auth OK — received webhook from nIAM:", JSON.stringify(data));

    if (data.action === "add_User") {
      const validEmail = data.email?.includes("@") ? data.email : null;

      if (!validEmail) {
        console.warn(
          `[webhook] ⚠️ Skipping staffUser creation — email "${data.email}" is not valid. ` +
          `Fix body mapping: change "email" → "action.name" to "email" → "email" or "ticket.raised_For.email"`
        );
      } else {
        const existingStaffUser = db
          .query("SELECT id, email, firstName FROM staffUser WHERE email = ?")
          .get(validEmail) as any;

        if (existingStaffUser) {
          console.log(`[webhook] staffUser already exists: ${validEmail} (id=${existingStaffUser.id})`);
        } else {
          const username = data.username || validEmail.split("@")[0] || "unknown";
          db.query(`
            INSERT INTO staffUser (email, username, firstName, department, source, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'nIAM', datetime('now'), datetime('now'))
          `).run(validEmail, username, username, "nIAM Synced");
          console.log(`[webhook] ✅ Created staffUser entry for ${validEmail} (username: ${username})`);
        }
      }
    } else if (data.action === "del_User") {
      const validEmail = data.email?.includes("@") ? data.email : null;
      if (validEmail) {
        db.query("DELETE FROM staffUser WHERE email = ?")
          .run(validEmail);
        console.log(`[webhook] ✅ Deleted staffUser: ${validEmail}`);
      }
    }

    return { success: true, message: "Webhook received", timestamp: new Date().toISOString() };
  })

  // ─── Public API: Health check ───────────────────────────────────
  .get("/api/health", () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  })

  .listen(3456);

console.log(`🏢 HR Software running at http://localhost:${app.server?.port}`);
