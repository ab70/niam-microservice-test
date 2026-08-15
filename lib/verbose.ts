/**
 * lib/verbose.ts — shared verbose logging for the demo.
 *
 * Prints every API call the demo makes: WHY it was made → method + URL →
 * request body → response status + body. Secrets (client_secret) are masked
 * so the log stays safe to share.
 *
 * Set DEMO_VERBOSE=0 to silence the per-call trace (the ✔/✘ checks still print).
 */
export const CYAN = "\x1b[36m",
  GREEN = "\x1b[32m",
  RED = "\x1b[31m",
  YELLOW = "\x1b[33m",
  DIM = "\x1b[2m",
  BOLD = "\x1b[1m",
  RESET = "\x1b[0m";

const enabled = (process.env.DEMO_VERBOSE ?? "1") !== "0";
export const isVerbose = () => enabled;
export const vlog = (msg: string) => {
  if (enabled) console.log(msg);
};

// Mask client_secret (and any other secret-ish form fields) in log output.
export const maskSecrets = (s: string) =>
  s.replace(/(client_secret=)[^&]*/g, "$1***").replace(/(Authorization: Bearer )[A-Za-z0-9._-]+/g, "$1***");

// Trim long values (JWTs, big JSON) so the log stays readable.
export const summarize = (v: any, max = 220) => {
  let s: string;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? s.slice(0, max) + `…(+${s.length - max} chars)` : s;
};
