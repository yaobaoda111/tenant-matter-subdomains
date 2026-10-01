import { infrai } from "./infrai";

const bucket = process.env.INFRAI_DOCUMENT_BUCKET ?? "legal-signed-documents";
await infrai.storage.bucket.create({ name: bucket });
console.log(`Document bucket ready: ${bucket}`);
