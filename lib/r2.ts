import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, ListBucketsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

// Cloudflare R2 est compatible S3. Variables requises :
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
//   R2_PUBLIC_URL (domaine public du bucket, ex: https://media.tondomaine.com
//   ou l'URL r2.dev) — Zernio doit pouvoir télécharger la vidéo via cette URL.
export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_URL
  );
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // Les versions récentes du SDK ajoutent un checksum CRC32 aux URLs
      // présignées, que le navigateur n'envoie pas → R2 rejette le PUT.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export function r2PublicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL!.replace(/\/+$/, "")}/${key}`;
}

function safeName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(-80) || "video";
}

// Clé rangée par utilisateur et par mois : u/<userId>/2026-10/<uuid>-nom.mp4
export function buildObjectKey(userId: string, filename: string): string {
  const month = new Date().toISOString().slice(0, 7);
  return `u/${userId}/${month}/${randomUUID()}-${safeName(filename)}`;
}

export async function r2GetPresignedUpload(params: {
  userId: string;
  filename: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const expiresIn = params.expiresInSeconds ?? 3600;
  const key = buildObjectKey(params.userId, params.filename);
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      ContentType: params.contentType,
    }),
    { expiresIn }
  );
  return {
    key,
    uploadUrl,
    publicUrl: r2PublicUrl(key),
    expires: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

// Upload côté serveur (utilisé plus tard par le bot Telegram).
export async function r2PutObject(params: {
  key: string;
  body: Buffer | Uint8Array | ReadableStream | import("stream").Readable;
  contentType: string;
}) {
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: params.key,
      Body: params.body as never,
      ContentType: params.contentType,
    })
  );
  return r2PublicUrl(params.key);
}

export async function r2DeleteObject(key: string) {
  await getClient().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
}

// Sonde de diagnostic : que PEUT faire ce jeton ? Permet de distinguer un jeton
// en lecture seule (lecture OK, écriture refusée) d'un jeton limité à un autre
// compartiment (rien d'autorisé ici). Ne modifie rien.
export type R2AccessProbe = {
  read: "ok" | "denied" | "missing" | "error";
  readMessage?: string;
  buckets: string[] | null; // compartiments visibles par le jeton (null = liste interdite)
};
export async function r2ProbeAccess(): Promise<R2AccessProbe> {
  const c = getClient();
  let read: R2AccessProbe["read"] = "ok";
  let readMessage: string | undefined;
  try {
    await c.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET!, MaxKeys: 1 }));
  } catch (e) {
    const err = e as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const code = err.Code ?? err.name ?? "";
    readMessage = err.message;
    read = /AccessDenied/i.test(code) || err.$metadata?.httpStatusCode === 403 ? "denied" : /NoSuchBucket/i.test(code) || err.$metadata?.httpStatusCode === 404 ? "missing" : "error";
  }
  let buckets: string[] | null = null;
  try {
    const res = await c.send(new ListBucketsCommand({}));
    buckets = (res.Buckets ?? []).map((b) => b.Name ?? "").filter(Boolean);
  } catch { /* liste interdite pour ce type de jeton : normal */ }
  return { read, readMessage, buckets };
}
