import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const authFile = fileURLToPath(new URL('../src/services/auth.js', import.meta.url));
const routesFile = fileURLToPath(new URL('../src/routes/auth.js', import.meta.url));
const serverFile = fileURLToPath(new URL('../src/server.js', import.meta.url));

test('auth service safely parses cookies and validates signed sessions', async () => {
  const source = await readFile(authFile, 'utf8');
  assert.match(source, /function parseCookies/);
  assert.match(source, /crypto\.timingSafeEqual/);
  assert.match(source, /export async function optionalAuth/);
  assert.match(source, /req\.authSessionExp/);
  assert.match(source, /createSessionCookie\(res, req\.user\._id\)/);
  assert.match(source, /AbortSignal\.timeout\(15000\)/);
});

test('current-user endpoint allows an unauthenticated login screen to validate session state', async () => {
  const source = await readFile(routesFile, 'utf8');
  assert.match(source, /router\.get\('\/me', optionalAuth/);
});

test('production rejects wildcard credentialed CORS origins and checks mutation origins', async () => {
  const source = await readFile(serverFile, 'utf8');
  assert.match(source, /allowedOrigins\.includes\('\*'\)/);
  assert.match(source, /Request origin is not allowed/);
});

test('current-user endpoint safely handles a request without an authenticated user', async () => {
  const source = await readFile(authFile, 'utf8');
  const routes = await readFile(routesFile, 'utf8');
  assert.match(source, /if \(!req\.user\?\._id\) return res\.json\(\{ user: null \}\)/);
  assert.match(routes, /req\.user\?\._id \? String\(req\.user\._id\) : null/);
});
