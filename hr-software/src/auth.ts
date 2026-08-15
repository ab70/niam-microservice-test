import { db } from "./db"; // named export

// Session store: token → { userId, type }
// Stores the user type alongside the ID so we know which table to query,
// avoiding ID collisions between `users` and `staffUser` tables (both start at 1).
const sessions = new Map<string, { userId: number; type: "staff" | "admin" }>();

export function createSession(userId: number, type: "staff" | "admin"): string {
  const token = crypto.randomUUID();
  sessions.set(token, { userId, type });
  console.log(`[auth.createSession] created session for userId=${userId} type=${type} | map size:`, sessions.size);
  return token;
}

export function destroySession(token: string) {
  sessions.delete(token);
}

export function getSessionUser(token: string | undefined): { id: number; email: string; firstName: string; lastName: string; role: string } | null {
  console.log("[auth.getSessionUser] token present:", !!token, token ? `(${token.slice(0, 8)}…)` : "");
  if (!token) return null;
  const session = sessions.get(token);
  console.log("[auth.getSessionUser] session from map:", session ? `userId=${session.userId} type=${session.type}` : "undefined");
  if (!session) {
    console.log("[auth.getSessionUser] ❌ No session found for token (map size:", sessions.size, ")");
    return null;
  }

  const { userId, type } = session;

  if (type === "staff") {
    // SSO user — query staffUser table
    const staffUser = db.query("SELECT id, email, firstName, lastName, 'staff' as role FROM staffUser WHERE id = ? AND active = 1").get(userId) as any;
    if (staffUser) {
      console.log("[auth.getSessionUser] staff user resolved:", staffUser.email);
      return staffUser;
    }
    console.log("[auth.getSessionUser] ❌ staff user not found in staffUser table for id:", userId);
    return null;
  }

  // Admin user — query users table
  const adminUser = db.query("SELECT id, email, firstName, lastName, role FROM users WHERE id = ? AND active = 1").get(userId) as any;
  if (adminUser) {
    console.log("[auth.getSessionUser] admin user resolved:", adminUser.email);
    return adminUser;
  }

  console.log("[auth.getSessionUser] ❌ admin user not found in users table for id:", userId);
  return null;
}

/**
 * Extract session token from cookie header string.
 */
export function extractToken(cookieHeader: string | null): string | undefined {
  console.log("[auth.extractToken] cookie header:", cookieHeader ?? "(none)");
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  const token = match?.[1];
  console.log("[auth.extractToken] extracted token:", token ? `(${token.slice(0, 8)}…)` : "(none)");
  return token;
}
