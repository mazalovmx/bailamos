// Explicit temporary launch mode; enabled by default for existing deployments.
export const emailAuthEnabled = (env: Record<string, string | undefined> = process.env) => env.EMAIL_AUTH_ENABLED !== 'false';
