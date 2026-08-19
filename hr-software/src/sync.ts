/**
 * Push staff data and leave events to niam-logger's webhook endpoint.
 *
 * niam-logger expects:
 *   POST /niam/worker/webhook
 *   Headers: x-tenant-id (encrypted), x-signature (optional)
 *
 * Employee body:
 *   { type: "EMPLOYEE", action: "ADD"|"UPDATE"|"REMOVE", data: [ { ...staff fields } ] }
 *
 * Leave body:
 *   { type: "LEAVE", action: "ADD"|"UPDATE"|"REMOVE",
 *     data: { userId: "email", leaveStart: "ISO", leaveEnds: "ISO", actingUser: "email"? } }
 *
 * For local dev we skip the encryption/signature — the webhook middleware
 * has a DEV_MODE bypass. In production you'd encrypt the tenant DB name
 * with TENANT_SECRET and sign the body.
 */

const NIAM_LOGGER_URL = process.env.NIAM_LOGGER_URL || "http://localhost:4001";
const TENANT_ID = process.env.TENANT_ID || "ca255d4da9a47d83426ceb6db7491d94:c5efb2a08a91236e10a25183bd5ec011:3abebda092a609c1";

export type WebhookAction = "ADD" | "UPDATE" | "REMOVE";

export interface StaffPayload {
  firstName?: string;
  lastName?: string;
  email?: string;
  nick_Name?: string;
  employee_Id?: string;
  phone?: string;
  address?: string;
  office?: string;
  joining_Date?: string;
  effective_Date?: string;
  division?: string;
  designation?: string;
  band?: string;
  position?: string;
  department?: string;
  section?: string;
  sub_Section?: string;
  unit?: string;
  supervisor?: string;
  supervisorName?: string;
  domain?: string;
  password?: string;
  allAccess?: any[];
}

// niam-logger's webhook schema validates joining_Date/effective_Date as ISO
// datetimes (z.string().datetime()). HTML date inputs send "YYYY-MM-DD" and a
// cleared field sends "" — BOTH fail the parse, and webHook_Controller's
// fallback silently downgrades the envelope to action=ADD (an UPDATE becomes a
// no-op "User already there" failure). Normalize before pushing.
const DATE_FIELDS = ["joining_Date", "effective_Date"];

export function normalizeStaff(staff: StaffPayload[]): StaffPayload[] {
  return staff.map((s) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(s)) {
      if (DATE_FIELDS.includes(k)) {
        if (!v) continue; // empty date — drop, the schema rejects ""
        if (typeof v === "string" && !v.includes("T")) {
          const d = new Date(v);
          out[k] = isNaN(d.getTime()) ? v : d.toISOString(); // invalid dates pass through rather than throw
        } else {
          out[k] = v;
        }
      } else {
        out[k] = v;
      }
    }
    return out as StaffPayload;
  });
}

export async function pushStaffToNiamLogger(staff: StaffPayload[], action: WebhookAction = "ADD") {
  try {
    const url = `${NIAM_LOGGER_URL}/niam/worker/webhook`;

    const payload = {
      type: "EMPLOYEE",
      action,
      data: normalizeStaff(staff),
    };

    console.log(`[sync] ──── REQUEST ────`);
    console.log(`[sync] URL:    ${url}`);
    console.log(`[sync] Method: POST`);
    console.log(`[sync] Headers:`, JSON.stringify({ "Content-Type": "application/json", "x-tenant-id": TENANT_ID }, null, 2));
    console.log(`[sync] Body:   `, JSON.stringify(payload, null, 2));
    console.log(`[sync] ────────────────`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": TENANT_ID,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();

    console.log(`[sync] ──── RESPONSE ────`);
    console.log(`[sync] Status: ${res.status} ${res.statusText}`);
    console.log(`[sync] Body:   `, JSON.stringify(body, null, 2));
    console.log(`[sync] ─────────────────`);
    console.log(`[sync] Pushed ${staff.length} staff (${action}) to niam-logger:`, body);
    return body;
  } catch (err: any) {
    console.error(`[sync] ──── ERROR ────`);
    console.error(`[sync] Failed to push to niam-logger (${action}):`, err.message);
    console.error(`[sync] ──────────────`);
    // Non-blocking — don't fail the operation just because sync failed
    return { success: false, message: err.message };
  }
}

// ── Leave payload ─────────────────────────────────────────────────
export interface LeavePayload {
  userId: string;        // email of person on leave
  leaveStart: string;    // ISO datetime
  leaveEnds: string;     // ISO datetime
  actingUser?: string;   // email of deputy (optional)
}

export type LeaveAction = "ADD" | "UPDATE" | "REMOVE";

/**
 * Normalize leave dates to ISO datetime strings.
 * Accepts "YYYY-MM-DD" (from date inputs) or empty strings.
 */
function normalizeLeaveDate(dateStr: string): string {
  if (!dateStr) return "";
  if (dateStr.includes("T")) return dateStr; // already ISO
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toISOString();
}

/**
 * Push a leave event to niam-logger's webhook.
 * Works for ADD (create leave), UPDATE (change dates/deputy), and REMOVE (delete leave).
 */
export async function pushLeaveToNiamLogger(
  leave: LeavePayload,
  action: LeaveAction = "ADD"
) {
  try {
    const url = `${NIAM_LOGGER_URL}/niam/worker/webhook`;

    const payload = {
      type: "LEAVE",
      action,
      data: {
        userId: leave.userId,
        leaveStart: normalizeLeaveDate(leave.leaveStart),
        leaveEnds: normalizeLeaveDate(leave.leaveEnds),
        ...(leave.actingUser && { actingUser: leave.actingUser }),
      },
    };

    console.log(`[sync] ──── LEAVE REQUEST ────`);
    console.log(`[sync] URL:    ${url}`);
    console.log(`[sync] Body:   `, JSON.stringify(payload, null, 2));
    console.log(`[sync] ──────────────────────`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": TENANT_ID,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();

    console.log(`[sync] ──── LEAVE RESPONSE ────`);
    console.log(`[sync] Status: ${res.status} ${res.statusText}`);
    console.log(`[sync] Body:   `, JSON.stringify(body, null, 2));
    console.log(`[sync] ───────────────────────`);
    return body;
  } catch (err: any) {
    console.error(`[sync] Failed to push leave to niam-logger (${action}):`, err.message);
    return { success: false, message: err.message };
  }
}
