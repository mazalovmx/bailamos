import {createPrivateKey, sign} from 'node:crypto';

// Apple uses an ES256 client-secret JWT. Generate a short-lived one for each OAuth round trip.
export function appleClientSecret({clientId, teamId, keyId, privateKey}: {clientId: string; teamId: string; keyId: string; privateKey: string}, now = Math.floor(Date.now() / 1000)) {
  const key = createPrivateKey(privateKey.replace(/\\n/g, '\n'));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('APPLE_KEY_MUST_BE_P256');
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = encode({alg: 'ES256', kid: keyId}) + '.' + encode({iss: teamId, sub: clientId, aud: 'https://appleid.apple.com', iat: now, exp: now + 3600});
  return body + '.' + sign('sha256', Buffer.from(body), {key, dsaEncoding: 'ieee-p1363'}).toString('base64url');
}
