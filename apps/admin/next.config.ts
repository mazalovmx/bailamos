import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
// The panel is never embedded, indexed or cached by intermediaries.
const headers = [
  {key: 'X-Frame-Options', value: 'DENY'}, {key: 'X-Content-Type-Options', value: 'nosniff'},
  {key: 'Referrer-Policy', value: 'no-referrer'}, {key: 'X-Robots-Tag', value: 'noindex, nofollow'},
  {key: 'Cache-Control', value: 'no-store'}
];
export default {poweredByHeader: false, transpilePackages: ['@dance/db'], headers: async () => [{source: '/:path*', headers}]};
