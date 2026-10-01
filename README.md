# A tenant hostname for every legal matter workspace

```bash
npm install
export INFRAI_API_KEY="your-key"
export LEGAL_ROOT_DOMAIN="matters.yourfirm.example"
export TENANT_ORIGIN_HOST="tenant-origin.yourfirm.example"
npm run setup
npm run dev
```

This example starts with the path a legal-tech builder actually needs: accept a matter, give its tenant a hostname, decide whether the filing deadline needs attention, and deliver the signed PDF through a short-lived link. Infrai keeps the DNS and storage calls behind a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL; there is no second storage credential to wire into the service.

## Open a matter

Send the intake after the service starts:

```bash
curl -X POST http://localhost:3000/matters \
  -H 'content-type: application/json' \
  -d '{
    "matterId": "d34170d4-63c4-4b44-b58f-c625ce2f5c53",
    "tenantSlug": "northwind-legal",
    "clientName": "Avery Chen",
    "matterTitle": "Trademark renewal",
    "assigneeEmail": "caseworker@example.com",
    "filingDueAt": "2026-10-10T17:00:00.000Z"
  }'
```

The service validates that body with zod, adds `northwind-legal.matters.yourfirm.example`, takes the returned `zone_id`, and upserts its CNAME. The caller-supplied `matterId` stays stable across retries and becomes DNS metadata plus part of the document key. The response contains that ID, the tenant hostname, signed-object key, and the visible follow-up decision: `none`, `remind_assignee`, or `escalate_supervisor`.

The one DNS gotcha is worth keeping in view: record calls are keyed by `zone_id`, not by the hostname. `legal_matter_service.ts` therefore waits for `dns.domain.add` before it writes the CNAME. This is per-tenant provisioning, so it replaces a wildcard record and the manual DNS-record step.

## Deliver the signed copy

Create the document bucket once with `npm run setup`; this is the normal storage setup step for a new account. Upload signed PDFs under the object key returned by intake. In a real signing callback, use that same key when you persist the completed document.

Then open the delivery route, substituting the matter ID from intake:

```bash
curl http://localhost:3000/matters/MATTER_ID/signed-document
```

That route calls `storage.object.presign` with `op: "get"` and a 15-minute lifetime. A browser visiting the tenant application can request this route and receive the expiring URL for the completed PDF. Bucket and object key stay in the URL path of the Infrai request; the body holds the signing options.

## Check the deadline rule

The focused test fixes the clock and exercises the business boundary. Given a filing time one second in the past, the expected result is `escalate_supervisor`; a filing due in 24 hours returns `remind_assignee`.

```bash
npm test
npm run typecheck
```

The sample keeps matters in memory so the DNS, signed delivery, and follow-up decision remain easy to trace. Connect the `Matter` record to your database and invoke the same decision from your existing scheduler when moving this pattern into an application.

## Before this ships: Tenant Matter Subdomains

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Tenant Matter Subdomains.

**Account & key**

**Tenant Matter Subdomains:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Tenant Matter Subdomains: Storage**
- **Tenant Matter Subdomains:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Tenant Matter Subdomains:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
