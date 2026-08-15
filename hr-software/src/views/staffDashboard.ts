export const staffDashboardPage = (user: { id: number; email: string; firstName: string; lastName: string; role: string }) => /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HR Software — My Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #1e293b;
    }

    /* ── Topbar ─────────────────────────────────────────── */
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 32px;
      background: rgba(255,255,255,.95);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(0,0,0,.08);
    }
    .topbar h1 { font-size: 1.15rem; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; }
    .topbar h1 .badge-sso {
      font-size: .6rem; background: #8b5cf6; color: #fff;
      padding: 2px 8px; border-radius: 999px; font-weight: 600;
      letter-spacing: .3px;
    }
    .topbar .right { display: flex; align-items: center; gap: 16px; }
    .topbar .right span { color: #64748b; font-size: .85rem; }
    .topbar .right a {
      color: #ef4444; text-decoration: none; font-size: .85rem; font-weight: 600;
    }
    .topbar .right a:hover { text-decoration: underline; }

    /* ── Main layout ────────────────────────────────────── */
    .main { max-width: 800px; margin: 40px auto; padding: 0 24px; }

    /* ── Profile Card ───────────────────────────────────── */
    .profile-card {
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,.15);
      overflow: hidden;
    }

    .profile-cover {
      height: 140px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      position: relative;
    }

    .profile-avatar {
      position: absolute;
      bottom: -48px;
      left: 40px;
      width: 96px;
      height: 96px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: 4px solid #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      color: #fff;
      font-weight: 700;
      box-shadow: 0 4px 12px rgba(0,0,0,.15);
    }

    .profile-body {
      padding: 60px 40px 32px;
    }

    .profile-body h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }

    .profile-body .email {
      color: #64748b;
      font-size: .9rem;
      margin-bottom: 20px;
    }

    .profile-body .sso-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: #f0e7ff;
      color: #6d28d9;
      border-radius: 999px;
      font-size: .75rem;
      font-weight: 600;
      margin-bottom: 24px;
    }

    /* ── Info Grid ──────────────────────────────────────── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }

    .info-item {
      padding: 16px;
      background: #f8fafc;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
    }
    .info-item .label {
      font-size: .7rem;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: #94a3b8;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .info-item .value {
      font-size: .9rem;
      font-weight: 600;
      color: #0f172a;
      word-break: break-all;
    }

    /* ── Status ─────────────────────────────────────────── */
    .status-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 12px;
    }
    .status-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34,197,94,.4);
    }
    .status-row span {
      font-size: .85rem;
      font-weight: 600;
      color: #166534;
    }

    /* ── Actions ────────────────────────────────────────── */
    .actions {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      gap: 12px;
    }

    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 20px; font-size: .85rem; font-weight: 600;
      border: none; border-radius: 8px; cursor: pointer; transition: all .2s;
      text-decoration: none;
    }
    .btn-primary {
      background: #3b82f6; color: #fff;
    }
    .btn-primary:hover { background: #2563eb; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59,130,246,.3); }
    .btn-danger {
      background: #ef4444; color: #fff;
    }
    .btn-danger:hover { background: #dc2626; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239,68,68,.3); }

    /* ── Login info ─────────────────────────────────────── */
    .login-info {
      margin-top: 40px;
      text-align: center;
    }
    .login-info p {
      color: rgba(255,255,255,.8);
      font-size: .8rem;
    }
    .login-info a {
      color: #fff;
      text-decoration: underline;
      font-weight: 600;
    }
    .login-info a:hover { opacity: .8; }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>
      🏢 HR Software
      <span class="badge-sso">SSO</span>
    </h1>
    <div class="right">
      <span>👤 ${user.firstName || user.email}</span>
      <a href="/logout">Logout</a>
    </div>
  </div>

  <div class="main">
    <div class="profile-card">
      <div class="profile-cover">
        <div class="profile-avatar">
          ${(user.firstName || user.email).charAt(0).toUpperCase()}
        </div>
      </div>

      <div class="profile-body">
        <h2>${user.firstName || ''} ${user.lastName || ''}</h2>
        <div class="email">${user.email}</div>
        <div class="sso-badge">
          🔐 Authenticated via NIAM SSO
        </div>

        <div class="info-grid">
          <div class="info-item">
            <div class="label">User ID</div>
            <div class="value">#${user.id}</div>
          </div>
          <div class="info-item">
            <div class="label">Email</div>
            <div class="value">${user.email}</div>
          </div>
          <div class="info-item">
            <div class="label">Name</div>
            <div class="value">${user.firstName || '—'} ${user.lastName || ''}</div>
          </div>
          <div class="info-item">
            <div class="label">Role</div>
            <div class="value">Staff</div>
          </div>
        </div>

        <div class="status-row">
          <div class="status-dot"></div>
          <span>Session Active — Logged in via NIAM SSO</span>
        </div>

        <div class="actions">
          <a href="/logout" class="btn btn-danger">🚪 Logout</a>
        </div>
      </div>
    </div>

    <div class="login-info">
      <p>Managed by <a href="http://localhost:3000" target="_blank">nIAM Identity & Access Management</a></p>
    </div>
  </div>
</body>
</html>`;
