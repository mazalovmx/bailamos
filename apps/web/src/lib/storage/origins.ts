const origin = (value: string | undefined) => {
  try {
    const url = value ? new URL(value) : null;
    return url && ['https:', 'http:'].includes(url.protocol) ? url.origin : '';
  } catch {return '';}
};
/** Browser policy must allow the bucket host used by virtual-hosted S3 uploads, as well as the endpoint/CDN. */
export function mediaOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = new Set([origin(env.S3_PUBLIC_URL), origin(env.S3_ENDPOINT)].filter(Boolean));
  if (env.MEDIA_STORAGE === 'local' || !env.S3_BUCKET) return [...origins];
  const region = env.S3_REGION || 'us-east-1';
  const endpoint = origin(env.S3_ENDPOINT || `https://s3.${region}.amazonaws.com${region.startsWith('cn-') ? '.cn' : ''}`);
  if (!endpoint) return [...origins];
  const forcePathStyle = env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === 'true' : !!env.S3_ENDPOINT;
  const upload = new URL(endpoint);
  // Like the SDK, keep dotted HTTPS bucket names and non-DNS bucket names in the path.
  const virtualHost = !forcePathStyle && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(env.S3_BUCKET)
    && !(upload.protocol === 'https:' && env.S3_BUCKET.includes('.'));
  if (virtualHost) upload.hostname = env.S3_BUCKET + '.' + upload.hostname;
  origins.add(upload.origin);
  return [...origins];
}
