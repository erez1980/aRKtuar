'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
// Unit harness only: no Supabase project, real JWT, key or document is used.
const source = readFileSync(require('node:path').join(__dirname, '../supabase/functions/arktuar-ai/index.ts'), 'utf8').replace(/^import .*;$/m, '');
const code = stripTypeScriptTypes(source);
function harness(options = {}) {
  const calls = { auth: 0, quota: 0, upstream: 0, writes: [], logs: [] };
  let handler;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test', ANTHROPIC_API_KEY: options.noKey ? '' : 'test-key', ALLOWED_ORIGINS: 'https://erez1980.github.io', ARKTUAR_OPEN: 'true' };
  const admin = {
    auth: { getUser: async () => { calls.auth++; return options.invalidToken ? { error: true } : { data: { user: { id: 'test-user', email: 'Owner@Example.com' } } }; } },
    from: table => {
      assert.equal(table, 'arktuar_allowlist');
      return { select: () => ({ eq: (_field, email) => {
        assert.equal(email, 'owner@example.com');
        return { maybeSingle: async () => ({ data: options.denied ? null : { daily_limit: options.limit ?? 30 }, error: options.allowError ? true : null }) };
      } }) };
    },
    rpc: async (name, args) => { calls.quota++; calls.writes.push({ name, args }); return { data: options.exhausted ? -1 : 1, error: options.quotaError ? true : null }; }
  };
  const context = vm.createContext({
    Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
    createClient: () => admin, Request, Response, AbortSignal,
    console: { error: (...args) => calls.logs.push(args) },
    fetch: async (url, init) => {
      calls.upstream++;
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers['x-api-key'], 'test-key');
      if (options.networkError) throw new Error('private document must not leak');
      return new Response(JSON.stringify(options.upstreamBody || { content: [{ type: 'text', text: '{"items":[]}' }] }), { status: options.upstreamStatus || 200 });
    }
  });
  vm.runInContext(code, context);
  const request = (body = { task: 'extract', files: [{ mediaType: 'application/pdf', data: 'c2FtcGxl' }] }, token = 'sample-jwt', origin = 'https://erez1980.github.io') => handler(new Request('https://example.supabase.co/functions/v1/arktuar-ai', { method: 'POST', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { request, calls };
}
test('signed-out request is 401 even when Anthropic key absent; invalid JWT is 401', async () => {
  const h = harness({ noKey: true }); assert.equal((await h.request(undefined, '')).status, 401);
  assert.equal(h.calls.auth, 0); assert.equal(h.calls.quota, 0);
  assert.equal((await harness({ invalidToken: true }).request()).status, 401);
});
test('non-allowlisted user is 403 even if legacy OPEN flag is present', async () => {
  const h = harness({ denied: true }); assert.equal((await h.request()).status, 403);
  assert.equal(h.calls.quota, 0); assert.equal(h.calls.upstream, 0);
});
test('allowlist failure, zero quota and missing key fail closed', async () => {
  assert.equal((await harness({ allowError: true }).request()).status, 500);
  assert.equal((await harness({ limit: 0 }).request()).status, 403);
  assert.equal((await harness({ noKey: true }).request()).status, 500);
});
test('authorized sample PDF calls upstream and stores quota metadata only', async () => {
  const h = harness(), r = await h.request();
  assert.equal(r.status, 200); const body = await r.json();
  assert.equal(body.ok, true); assert.deepEqual(body.usage, { calls: 1, limit: 30 });
  assert.equal(h.calls.quota, 1); assert.equal(h.calls.upstream, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.writes)), [{ name: 'arktuar_consume', args: { p_user: 'test-user', p_limit: 30 } }]);
  assert.equal(h.calls.logs.length, 0);
});
test('malformed payload and unapproved origin do not consume quota', async () => {
  const h = harness();
  assert.equal((await h.request({ task: 'extract', files: [] })).status, 400);
  assert.equal((await h.request({ task: 'other' })).status, 400);
  assert.equal((await h.request(undefined, 'sample-jwt', 'https://unapproved.example')).status, 403);
  assert.equal(h.calls.quota, 0);
});
test('exhausted quota returns 429 and does not send document to upstream', async () => {
  const h = harness({ exhausted: true }); assert.equal((await h.request()).status, 429);
  assert.equal(h.calls.upstream, 0);
});
test('upstream network and malformed AI responses return sanitized errors', async () => {
  const h = harness({ networkError: true }), response = await h.request();
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('private document'));
  assert.equal(h.calls.logs.length, 0);
  assert.equal((await harness({ upstreamBody: { content: [{ type: 'text', text: 'not json' }] } }).request()).status, 502);
});
