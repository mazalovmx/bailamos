import type {MetadataRoute} from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {name: 'Dance Community', short_name: 'Dance', start_url: '/', display: 'standalone',
    background_color: '#f6f4ee', theme_color: '#253b2f',
    icons: [{src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any'}]};
}
