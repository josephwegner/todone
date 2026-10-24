export const LocalDevelopment = {
  cognitoEndpoint: 'http://localhost:9229',
  cognitoPort: 9229,
  apiPort: 3002,
  pwaPort: 3001,
  seedDirectory: '.local-dev',
  seedFile: 'seed.json',
  seedVersion: 1,
} as const;

/** Development tooling has no remote fallback or real AWS credentials. */
export function requireLocalCognitoEndpoint(
  environment: Record<string, string | undefined>,
): string {
  if (environment.NODE_ENV === 'production')
    throw new Error('Local fixtures refuse production mode.');
  const endpoint = new URL(environment.COGNITO_LOCAL_ENDPOINT ?? LocalDevelopment.cognitoEndpoint);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.port !== String(LocalDevelopment.cognitoPort) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/'
  )
    throw new Error(
      'Local Cognito requires HTTP loopback on port 9229 without URL credentials or overrides.',
    );
  return endpoint.origin;
}
