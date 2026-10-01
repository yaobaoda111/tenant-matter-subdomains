import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { decideDeadlineFollowup, type FollowupAction } from "./deadline_followup";
import { InfraiError, infrai } from "./infrai";

const intakeSchema = z.object({
  matterId: z.string().uuid(),
  tenantSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  clientName: z.string().min(1).max(120),
  matterTitle: z.string().min(1).max(160),
  assigneeEmail: z.string().email(),
  filingDueAt: z.string().datetime(),
});

type Matter = z.infer<typeof intakeSchema> & {
  id: string;
  tenantHostname: string;
  followup: FollowupAction;
  signedObjectKey: string;
};

const matters = new Map<string, Matter>();
const rootDomain = process.env.LEGAL_ROOT_DOMAIN ?? "matters.example.com";
const tenantOrigin = process.env.TENANT_ORIGIN_HOST ?? "tenant-origin.example.com";
const documentBucket = process.env.INFRAI_DOCUMENT_BUCKET ?? "legal-signed-documents";

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function clientStatus(error: InfraiError): number {
  return error.status >= 400 && error.status < 500 ? error.status : 502;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "POST" && url.pathname === "/matters") {
      const input = intakeSchema.parse(await readJson(request));
      const id = input.matterId;
      const tenantHostname = `${input.tenantSlug}.${rootDomain}`;
      const zone = await infrai.dns.domain.add({
        domain: tenantHostname,
        metadata: { tenant_slug: input.tenantSlug, matter_id: id },
      });
      await infrai.dns.record.upsert({
        zone_id: zone.zone_id,
        record_type: "CNAME",
        name: "@",
        content: tenantOrigin,
        ttl: 300,
        proxied: true,
        metadata: { matter_id: id },
      });

      const matter: Matter = {
        ...input,
        id,
        tenantHostname,
        followup: decideDeadlineFollowup(new Date(input.filingDueAt), new Date()),
        signedObjectKey: `tenants/${input.tenantSlug}/matters/${id}/signed.pdf`,
      };
      matters.set(id, matter);
      json(response, 201, matter);
      return;
    }

    const match = url.pathname.match(/^\/matters\/([^/]+)\/signed-document$/);
    if (request.method === "GET" && match) {
      const matter = matters.get(match[1]);
      if (!matter) return json(response, 404, { error: "matter_not_found" });
      const signed = await infrai.storage.object.presign(documentBucket, matter.signedObjectKey, {
        op: "get",
        expires_seconds: 900,
        response_disposition: `attachment; filename="${matter.id}-signed.pdf"`,
        idempotency_key: `signed-delivery-${matter.id}`,
      });
      json(response, 200, {
        matterId: matter.id,
        tenantHostname: matter.tenantHostname,
        downloadUrl: signed.url,
        expiresAt: signed.expires_at,
      });
      return;
    }

    json(response, 404, { error: "route_not_found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(response, 400, { error: "invalid_intake", issues: error.issues });
    }
    if (error instanceof InfraiError) {
      return json(response, clientStatus(error), { error: error.code, detail: error.detail });
    }
    console.error(error);
    json(response, 500, { error: "internal_error" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Legal matter service listening on http://localhost:${port}`));
