export const errorPage = (title: string, message: string, showBackToLogin: boolean = true) => /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HR Software — Error</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 50%, #fecaca 100%);
      color: #1e293b;
    }

    .card {
      background: #ffffff;
      border: 1px solid #fecaca;
      border-radius: 16px;
      padding: 48px 40px;
      width: 100%; max-width: 420px;
      box-shadow: 0 10px 25px -5px rgba(239, 68, 68, .08), 0 4px 10px -4px rgba(239, 68, 68, .04);
      text-align: center;
    }

    .card .niam-logo {
      width: 64px; height: auto; margin-bottom: 16px;
    }


    .icon {
      font-size: 4rem;
      margin-bottom: 24px;
    }

    .card h1 {
      font-size: 1.5rem; font-weight: 700;
      margin-bottom: 12px; color: #dc2626;
    }

    .card .message {
      color: #64748b; margin-bottom: 32px; font-size: .95rem; line-height: 1.6;
    }

    .card .details {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      font-size: .85rem;
      color: #991b1b;
      text-align: left;
    }

    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 24px; font-size: .95rem; font-weight: 600;
      background: #3b82f6; color: #fff; border: none; border-radius: 10px;
      cursor: pointer; transition: background .2s, transform .1s;
      text-decoration: none;
    }

    .btn:hover { background: #2563eb; }
    .btn:active { transform: scale(.98); }

    .footer {
      margin-top: 24px; text-align: center; font-size: .75rem; color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="/niamofficiallogo.png" alt="nIAM Logo" class="niam-logo" />
    <div class="icon">🚫</div>
    <h1>${title}</h1>
    <p class="message">${message}</p>
    
    <div class="details">
      <strong>Error Details:</strong><br>
      You are not entitled to access this application using the current OIDC client configuration. Please contact your administrator to ensure your account is properly configured for SSO access.
    </div>

    ${showBackToLogin ? `
      <a href="/login" class="btn">
        ← Back to Login
      </a>
    ` : ''}

    <p class="footer">HR Software v0.1.0 · Secured by <a href="http://localhost:3000" target="_blank" style="color:#94a3b8; text-decoration:underline;">nIAM IAM</a></p>
  </div>
</body>
</html>`;
