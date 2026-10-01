// Limits are read on every call so tests and deployments can change them through the environment.
const int = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};
export const maxBytes = () => int('MEDIA_MAX_BYTES', 10 * 1024 * 1024);
/** Decoded pixel budget: 40 MP covers phone cameras and stops decompression bombs. */
export const maxPixels = () => int('MEDIA_MAX_PIXELS', 40_000_000);
export const maxDimension = () => int('MEDIA_MAX_DIMENSION', 12_000);
export const uploadsPerHour = () => int('MEDIA_UPLOADS_PER_HOUR', 60);
export const maxItemsPerParent = () => int('MEDIA_MAX_ITEMS', 60);
// Stock sharp binaries cannot decode HEVC, so HEIC/HEIF is accepted only when the deployment says its libvips can.
export const heicEnabled = () => process.env.MEDIA_ALLOW_HEIC === 'true';
export const allowedMimes = () => ['image/jpeg', 'image/png', 'image/webp', 'image/avif', ...(heicEnabled() ? ['image/heic', 'image/heif'] : [])];
