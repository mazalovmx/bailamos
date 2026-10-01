import {
  DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client
} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {assertKey, UPLOAD_TTL_SEC, type Storage} from './types';
export type S3Settings = {
  endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean
};
/** S3 is used only when a bucket and both credentials are present; otherwise the local driver takes over. */
export function s3Settings(env: NodeJS.ProcessEnv = process.env): S3Settings | null {
  const {S3_BUCKET: bucket, S3_ACCESS_KEY: accessKeyId, S3_SECRET_KEY: secretAccessKey} = env;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const endpoint = env.S3_ENDPOINT || undefined;
  return {
    endpoint, bucket, accessKeyId, secretAccessKey, region: env.S3_REGION || 'us-east-1',
    // MinIO and most self-hosted stores need path-style addressing; real AWS (no endpoint) does not.
    forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === 'true' : !!endpoint
  };
}
const missing = (error: unknown) => {
  const e = error as {name?: string; $metadata?: {httpStatusCode?: number}};
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};
export function s3Storage(settings: S3Settings): Storage {
  const Bucket = settings.bucket;
  const client = new S3Client({
    region: settings.region, endpoint: settings.endpoint, forcePathStyle: settings.forcePathStyle,
    credentials: {accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey},
    // Keep presigned URLs free of SDK checksum parameters the browser cannot satisfy.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED'
  });
  return {
    driver: 's3',
    async presignUpload(key, {mime, size, expiresSec = UPLOAD_TTL_SEC}) {
      // Content-Type and Content-Length are part of the signature: a different type or size is refused by the store.
      const url = await getSignedUrl(client, new PutObjectCommand({Bucket, Key: assertKey(key), ContentType: mime, ContentLength: size}),
        {expiresIn: expiresSec, signableHeaders: new Set(['content-type', 'content-length'])});
      return {url, method: 'PUT', headers: {'Content-Type': mime}, expiresAt: Date.now() + expiresSec * 1000};
    },
    async getObject(key) {
      try {
        const object = await client.send(new GetObjectCommand({Bucket, Key: assertKey(key)}));
        if (!object.Body) return null;
        return {body: object.Body.transformToWebStream() as ReadableStream<Uint8Array>, size: object.ContentLength, contentType: object.ContentType};
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async putObject(key, body, contentType) {
      await client.send(new PutObjectCommand({
        Bucket, Key: assertKey(key), Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable'
      }));
    },
    async deleteObjects(keys) {
      for (let start = 0; start < keys.length; start += 1000)
        await client.send(new DeleteObjectsCommand({Bucket, Delete: {Quiet: true, Objects: keys.slice(start, start + 1000).map(key => ({Key: assertKey(key)}))}}));
    },
    async deletePrefix(prefix) {
      if (!prefix.endsWith('/')) throw new Error('INVALID_STORAGE_KEY');
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({Bucket, Prefix: assertKey(prefix), ContinuationToken: token}));
        const keys = (page.Contents || []).flatMap(object => object.Key ? [{Key: object.Key}] : []);
        if (keys.length) await client.send(new DeleteObjectsCommand({Bucket, Delete: {Quiet: true, Objects: keys}}));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
    async exists(key) {
      try {await client.send(new HeadObjectCommand({Bucket, Key: assertKey(key)})); return true;}
      catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    }
  };
}
