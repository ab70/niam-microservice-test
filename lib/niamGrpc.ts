/**
 * lib/niamGrpc.ts — typed gRPC client for the nIAM STS gRPC surface
 * (IAM-side: elysia_niam src/app/services/sts/grpc, contract proto/iam/v1/iam.proto).
 *
 * This is the "later" counterpart of lib/niam.ts: the same IAM operations
 * (introspect, decide, get JWKS) but over a typed, binary transport instead
 * of HTTP+JSON. A service that adopts gRPC swaps its HTTP client for this —
 * the semantics, credentials and STS logic are identical. The .proto file
 * generates equivalent stubs for any language (Go, Java, Python, Rust…).
 *
 * v1 authn: Introspect authenticates as a service account via gRPC metadata
 * (x-client-id / x-client-secret). Decide trusts the presented token.
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { CYAN, GREEN, YELLOW, DIM, RED, RESET, vlog, maskSecrets, summarize } from "./verbose";

const PROTO_FILE = path.join(import.meta.dir, "../proto/iam/v1/iam.proto");

let ClientCtor: any = null;
const loadClient = () => {
  if (ClientCtor) return ClientCtor;
  const packageDefinition = protoLoader.loadSync(PROTO_FILE, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const def: any = grpc.loadPackageDefinition(packageDefinition);
  ClientCtor = def.iam.v1.IamService;
  return ClientCtor;
};

export interface NiamGrpcIntrospect {
  active: boolean;
  scope: string;
  client_id: string;
  sub: string;
  aud: string;
  iss: string;
  tenant: string;
  exp: string;
  iat: string;
  jti: string;
  token_type: string;
}

export interface NiamGrpcDecision {
  decision: "permit" | "deny";
  reason: string;
  required_scope: string;
  subject: string;
  tenant: string;
  scope: string;
}

export interface NiamGrpcJwk {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
  crv: string;
  x: string;
  y: string;
  json: string;
}

const DEFAULT_ADDRESS = "127.0.0.1:50051";

export class NiamGrpcClient {
  private client: any;
  readonly address: string;

  constructor(
    private creds: { client_Id: string; client_Secret?: string },
    opts: { address?: string } = {}
  ) {
    this.address = opts.address || process.env.GRPC_ADDR || DEFAULT_ADDRESS;
    const Ctor = loadClient();
    // Demo channel: insecure (see README — production adds mTLS per RFC 8705).
    this.client = new Ctor(this.address, grpc.credentials.createInsecure());
  }

  /** Attach the caller's service-account credentials as gRPC metadata. */
  private authMetadata(): grpc.Metadata {
    const md = new grpc.Metadata();
    md.set("x-client-id", this.creds.client_Id);
    if (this.creds.client_Secret) md.set("x-client-secret", this.creds.client_Secret);
    return md;
  }

  private call(method: string, request: any, md?: grpc.Metadata, why = ""): Promise<any> {
    const label = `gRPC iam.v1 ${method}`;
    vlog(`  ${CYAN}→ ${label}${RESET}`);
    vlog(`    ${DIM}why : ${why || label}${RESET}`);
    vlog(`    ${DIM}req : ${maskSecrets(summarize(request))}${RESET}`);
    return new Promise((resolve, reject) => {
      this.client[method](request, md || new grpc.Metadata(), (err: any, res: any) => {
        if (err) {
          vlog(`  ${RED}← ${label} error${RESET} ${DIM}${maskSecrets(summarize(err?.message))}${RESET}`);
          reject(err);
        } else {
          const color = res?.decision === "deny" ? YELLOW : GREEN;
          vlog(`  ${color}← ${label} ok${RESET} ${DIM}${maskSecrets(summarize(res))}${RESET}`);
          resolve(res);
        }
      });
    });
  }

  /** RFC 7662 introspection over gRPC (typed twin of the HTTP call). */
  async introspect(token: string): Promise<NiamGrpcIntrospect> {
    const res = await this.call(
      "Introspect",
      { token },
      this.authMetadata(),
      "ask the STS (iam.v1): is this token still active? (typed RFC 7662 introspection)"
    );
    // Map proto camelCase back to the RFC-style names the HTTP API uses.
    return {
      active: res.active === true,
      scope: res.scope || "",
      client_id: res.clientId || "",
      sub: res.sub || "",
      aud: res.aud || "",
      iss: res.iss || "",
      tenant: res.tenant || "",
      exp: res.exp || "",
      iat: res.iat || "",
      jti: res.jti || "",
      token_type: res.tokenType || "",
    };
  }

  /** PDP decision over gRPC — "may this token perform {action} on {resource}?". */
  async decide(opts: {
    token: string;
    resource?: string;
    action?: string;
    required_scope?: string;
    attributes?: Record<string, string>;
  }): Promise<NiamGrpcDecision> {
    const res = await this.call(
      "Decide",
      {
        token: opts.token,
        resource: opts.resource || "",
        action: opts.action || "",
        requiredScope: opts.required_scope || "",
        attributes: opts.attributes || {},
      },
      undefined,
      `PDP Decide over gRPC (iam.v1): may this token ${opts.action ? `'${opts.action}'` : ""} on ${opts.resource || opts.required_scope || "?"}? (typed permit/deny verdict)`
    );
    return {
      decision: res.decision as any,
      reason: res.reason || "",
      required_scope: res.requiredScope || "",
      subject: res.subject || "",
      tenant: res.tenant || "",
      scope: res.scope || "",
    };
  }

  /** RFC 7517 JWKS over gRPC. */
  async getJwks(tenant?: string): Promise<{ tenant: string; keys: NiamGrpcJwk[] }> {
    return this.call(
      "GetJWKS",
      { tenant: tenant || "" },
      undefined,
      "fetch the tenant signing keys over gRPC (RFC 7517 JWKS)"
    );
  }

  close() {
    try {
      this.client?.close();
    } catch {
      /* already closed */
    }
  }
}
