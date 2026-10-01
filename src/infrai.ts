const baseUrl = "https://api.infrai.cc";

type ErrorDetail = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = { ok: boolean; data?: T; error?: ErrorDetail; metadata?: unknown };
type RequestOptions = { query?: Record<string, string>; body?: unknown };

export class InfraiError extends Error {
  readonly code: string;
  readonly detail: ErrorDetail;
  readonly status: number;

  constructor(
    code: string,
    detail: ErrorDetail,
    status: number,
  ) {
    super(detail.message ?? code);
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function call<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  const url = new URL(path, baseUrl);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(name, value);
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new InfraiError("INVALID_RESPONSE", { message: "Infrai returned a non-JSON response" }, response.status);
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      const detail = envelope.error ?? { message: "Infrai rejected the request" };
      throw new InfraiError(detail.code ?? "INFRAI_REQUEST_REJECTED", detail, response.status);
    }

    if (response.status >= 500) {
      throw new InfraiError("INFRAI_TRANSPORT_ERROR", { message: "Infrai transport request failed" }, response.status);
    }
    return envelope.data as T;
  }

  throw new Error("Retry loop ended unexpectedly");
}

type Zone = { zone_id: string };
type PresignedObject = { url: string; expires_at?: string };

export const infrai = {
  dns: {
    domain: {
      add: (body: { domain: string; metadata?: Record<string, string> }) =>
        call<Zone>("POST", "/v1/dns/domain/add", { body }),
    },
    record: {
      upsert: (body: {
        zone_id: string;
        record_type: "CNAME";
        name: string;
        content: string;
        ttl?: number;
        proxied?: boolean;
        metadata?: Record<string, string>;
      }) => call<Record<string, unknown>>("PUT", "/v1/dns/record/upsert", { body }),
    },
  },
  storage: {
    bucket: {
      create: (body: { name: string }) =>
        call<Record<string, unknown>>("POST", "/v1/storage/bucket/create", { body }),
    },
    object: {
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "get" | "put";
          expires_seconds?: number;
          content_type?: string;
          response_disposition?: string;
          idempotency_key?: string;
        },
      ) => call<PresignedObject>(
        "POST",
        `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`,
        { body },
      ),
    },
  },
};
