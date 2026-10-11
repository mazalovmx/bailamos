import {returnTarget} from '../login-path';
export const socialProviderIds = ['google', 'microsoft', 'apple'] as const;
export type SocialProviderId = typeof socialProviderIds[number];
export const socialProviderNames: Record<SocialProviderId, string> = {google: 'Google', microsoft: 'Microsoft', apple: 'Apple'};
export const isSocialProvider = (value: string): value is SocialProviderId => socialProviderIds.some(id => id === value);

type Environment = Record<string, string | undefined>;
const configured = (env: Environment, ...keys: string[]) => keys.every(key => !!env[key]?.trim());
export function socialClientCredentials(provider: 'google' | 'microsoft', env: Environment = process.env) {
  const name = provider.toUpperCase();
  for (const [idKey, secretKey] of [[name + '_CLIENT_ID', name + '_CLIENT_SECRET'], ['CLIENT_ID_' + name, 'CLIENT_SECRET_' + name]]) {
    if (configured(env, idKey, secretKey)) return {clientId: env[idKey]!.trim(), clientSecret: env[secretKey]!.trim()};
  }
  return undefined;
}
export function enabledSocialProviders(env: Environment = process.env): SocialProviderId[] {
  return socialProviderIds.filter(provider => provider === 'apple'
    ? configured(env, 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY')
    : !!socialClientCredentials(provider, env));
}

export function socialSignInRequest(provider: SocialProviderId, mode: 'login' | 'register' | 'forgot', locale: string, origin: string, next?: string) {
  next = returnTarget(locale, next);
  const home = '/' + locale;
  const after = mode === 'forgot' ? home + '/settings' : next || home + '/account';
  const suffix = next ? '?next=' + encodeURIComponent(next) : '';
  return {provider, callbackURL: origin + after, newUserCallbackURL: origin + home + '/onboarding' + suffix,
    errorCallbackURL: origin + home + (mode === 'forgot' ? '/forgot-password' : '/login') + suffix,
    // Recovery must never create a new, empty account when a different identity is selected.
    requestSignUp: mode !== 'forgot'};
}
