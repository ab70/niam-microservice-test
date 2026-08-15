/**
 * Push staff data to niam-logger's webhook endpoint.
 *
 * niam-logger expects:
 *   POST /niam/worker/webhook
 *   Headers: x-tenant-id (encrypted), x-signature (optional)
 *   Body: { type: "EMPLOYEE", action: "ADD"|"UPDATE"|"REMOVE", data: [ { ...staff fields } ] }
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

export async function pushStaffToNiamLogger(staff: StaffPayload[], action: WebhookAction = "ADD") {
  try {
    const url = `${NIAM_LOGGER_URL}/niam/worker/webhook`;

    const payload = {
      type: "EMPLOYEE",
      action,
      data: staff,
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
