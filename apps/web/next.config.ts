import createNextIntlPlugin from 'next-intl/plugin';
import {config} from 'dotenv';
config({path: '../../.env', quiet: true});
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
export default withNextIntl({poweredByHeader: false, transpilePackages: ['@dance/db'],
  serverExternalPackages: ['sharp', 'ioredis', 'bullmq', 'web-push', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner']});
