export const loginPage = (error?: string) => /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HR Software — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #e0e7ff 0%, #dbeafe 50%, #ede9fe 100%);
      color: #1e293b;
    }

    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 48px 40px;
      width: 100%; max-width: 420px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, .08), 0 4px 10px -4px rgba(0, 0, 0, .04);
    }

    .card h1 {
      font-size: 1.75rem; font-weight: 700;
      text-align: center; margin-bottom: 8px; color: #0f172a;
    }

    .card .subtitle {
      text-align: center; color: #64748b; margin-bottom: 24px; font-size: .9rem;
    }

    /* ── Tabs ────────────────────────────────────── */
    .login-tabs {
      display: flex; gap: 4px; margin-bottom: 28px;
      background: #f1f5f9; border-radius: 10px; padding: 4px;
    }
    .login-tab {
      flex: 1; padding: 10px; text-align: center; font-size: .85rem; font-weight: 600;
      border: none; border-radius: 8px; cursor: pointer; transition: all .2s;
      background: transparent; color: #64748b;
    }
    .login-tab:hover { color: #334155; }
    .login-tab.active { background: #ffffff; color: #0f172a; box-shadow: 0 1px 3px rgba(0,0,0,.08); }

    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .field { margin-bottom: 20px; }

    label {
      display: block; font-size: .8rem; font-weight: 600;
      color: #475569; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px;
    }

    input {
      width: 100%; padding: 12px 14px; font-size: .95rem;
      background: #f8fafc; color: #0f172a;
      border: 1px solid #e2e8f0; border-radius: 10px;
      outline: none; transition: border-color .2s, box-shadow .2s;
    }

    input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }

    button[type="submit"] {
      width: 100%; padding: 14px; font-size: 1rem; font-weight: 600;
      background: #3b82f6; color: #fff; border: none; border-radius: 10px;
      cursor: pointer; transition: background .2s, transform .1s;
    }

    button[type="submit"]:hover { background: #2563eb; }
    button[type="submit"]:active { transform: scale(.98); }

    .error {
      background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
      padding: 10px 14px; border-radius: 8px; margin-bottom: 20px; font-size: .85rem;
    }

    .coming-soon {
      text-align: center; padding: 32px 16px;
      color: #64748b; font-size: .9rem;
    }
    .coming-soon .icon { font-size: 2rem; margin-bottom: 12px; }
    .coming-soon p { margin-bottom: 8px; }
    .coming-soon .badge {
      display: inline-block; padding: 4px 12px; border-radius: 999px;
      background: #eef2ff; color: #4338ca; font-size: .75rem; font-weight: 600;
    }

    .footer {
      margin-top: 24px; text-align: center; font-size: .75rem; color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🏢 HR Software</h1>
    <p class="subtitle">Sign in to your account</p>

    <!-- Login Type Tabs -->
    <div class="login-tabs">
      <button class="login-tab active" onclick="switchLogin('admin', this)">👤 Admin</button>
      <button class="login-tab" onclick="switchLogin('staff', this)">🧑‍💼 Staff</button>
    </div>

    ${error ? `<div class="error">${error}</div>` : ""}

    <!-- Admin Login Panel -->
    <div class="tab-panel active" id="panel-admin">
      <form method="POST" action="/login">
        <div class="field">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" placeholder="admin@admin.com" required autofocus />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" placeholder="••••••••" required />
        </div>
        <button type="submit">Sign In as Admin</button>
      </form>
    </div>

    <!-- Staff Login Panel (SSO via NIAM) -->
    <div class="tab-panel" id="panel-staff">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="/niamofficiallogo.png" alt="nIAM Logo" style="width: 72px; height: auto; margin-bottom: 16px;" />
        <p style="color: #64748b; font-size: .9rem; margin-bottom: 20px;">
          Sign in with your nIAM account to access the HR portal.
        </p>
        <a href="/auth/niam/login" style="
          display: inline-flex; align-items: center; gap: 12px;
          padding: 14px 28px; font-size: 1rem; font-weight: 600;
          background: #0f172a; color: #fff; border-radius: 10px;
          text-decoration: none; transition: background .2s, transform .1s;
          cursor: pointer;
        " onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='#0f172a'"
           onmousedown="this.style.transform='scale(.98)'" onmouseup="this.style.transform='scale(1)'">
          <img src="/niamofficiallogo.png" alt="" style="width: 24px; height: 24px; border-radius: 4px;" />
          Sign in with nIAM
        </a>
        <p style="color: #94a3b8; font-size: .75rem; margin-top: 16px;">
          Authenticated via nIAM OIDC · Secure SSO
        </p>
      </div>
    </div>

    <p class="footer">HR Software v0.1.0 · Elysia + SQLite</p>
  </div>

  <script>
    function switchLogin(type, el) {
      document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
      document.getElementById('panel-' + type).classList.add('active');
    }
  </script>
</body>
</html>`;
