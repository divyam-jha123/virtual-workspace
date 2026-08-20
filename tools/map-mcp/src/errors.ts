/**
 * Uniform error envelope shared by every tool handler.
 *
 * Rules of the road:
 *  - never throw a raw Error out of a tool; wrap it in `MapMcpError` so the
 *    caller always gets a `code` plus a `fix` hint it can act on.
 *  - never let a secret reach a diagnostic: `redact()` runs over every message.
 */

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  rule: string;
  message: string;
  /** Workspace-relative id or a JSON pointer into the map, when applicable. */
  path?: string;
  /** A concrete next step the model can take to recover. */
  fix?: string;
}

export interface ErrorEnvelope {
  ok: false;
  code: string;
  diagnostics: Diagnostic[];
}

export type OkEnvelope<T> = { ok: true } & T;

export type ErrorCode =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "INVALID_ARGUMENT"
  | "INVALID_MAP"
  | "VALIDATION_FAILED"
  | "ASSET_NOT_FOUND"
  | "ASSET_API_UNAVAILABLE"
  | "LIMIT_EXCEEDED"
  | "INTERNAL";

export class MapMcpError extends Error {
  readonly code: ErrorCode;
  readonly diagnostics: Diagnostic[];

  constructor(code: ErrorCode, message: string, opts: { rule?: string; path?: string; fix?: string; diagnostics?: Diagnostic[] } = {}) {
    super(message);
    this.name = "MapMcpError";
    this.code = code;
    this.diagnostics =
      opts.diagnostics ??
      [
        {
          severity: "error",
          rule: opts.rule ?? code.toLowerCase().replace(/_/g, "-"),
          message,
          ...(opts.path === undefined ? {} : { path: opts.path }),
          ...(opts.fix === undefined ? {} : { fix: opts.fix }),
        },
      ];
  }

  toEnvelope(): ErrorEnvelope {
    return {
      ok: false,
      code: this.code,
      diagnostics: this.diagnostics.map((d) => ({ ...d, message: redact(d.message), ...(d.fix ? { fix: redact(d.fix) } : {}) })),
    };
  }
}

/** Secrets that must never appear in a tool result or a log line. */
const secrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 6) secrets.add(value);
}

/** Strips known secrets and anything that looks like a credential header. */
export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("***redacted***");
  out = out.replace(/(authorization|x-api-key|api[-_]?key)(\s*[:=]\s*)(\S+)/gi, "$1$2***redacted***");
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer ***redacted***");
  return out;
}

export function toEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof MapMcpError) return err.toEnvelope();
  const message = err instanceof Error ? err.message : String(err);
  return new MapMcpError("INTERNAL", message).toEnvelope();
}
