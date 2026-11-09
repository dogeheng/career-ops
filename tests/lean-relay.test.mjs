import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changeState, readState, rememberAnswer } from '../lib/lean-apply.mjs';
import { loadRelayConfig, makeRelayClient, syncRelay } from '../lib/lean-relay.mjs';

async function waiting(t, questions) {
  const root = mkdtempSync(join(tmpdir(), 'career-relay-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const key = 'https://jobs.example/1';
  await changeState(root, state => { state.jobs[key] = { key, claim: 'fixture', status: 'waiting', company: 'Example', title: 'Engineer', questions }; });
  return { root, key };
}

test('relay configuration honors the environment and rejects credential-bearing remote HTTP', () => {
  const absent = join(tmpdir(), 'fixture-relay-config-does-not-exist.json');
  assert.equal(loadRelayConfig({}, absent), null);
  const config = loadRelayConfig({ DSH_OMNI_RELAY_TOKEN: 'relay_fixture', DSH_OMNI_RELAY_URL: 'http://127.0.0.1:3100/' }, absent);
  assert.equal(config.base, 'http://127.0.0.1:3100');
  assert.throws(() => loadRelayConfig({ DSH_OMNI_RELAY_TOKEN: 'relay_fixture', DSH_OMNI_RELAY_URL: 'http://example.test' }, absent), /HTTPS/);
});

test('HTTP relay keeps queued requests and saves only the exact quoted or coded reply', async t => {
  const { root, key } = await waiting(t, [{ text: 'Can you travel?', choices: ['Yes', 'No'] }, { text: 'Preferred start date?' }]);
  const posted = [], requests = new Map();
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer relay_fixture');
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const q = JSON.parse(body); posted.push(q);
      assert.equal(req.url, '/api/relay/ask');
      const id = 'r_' + posted.length;
      const data = { ok: true, id, status: posted.length === 1 ? 'sent' : 'queued', answer: null };
      requests.set(id, data); res.writeHead(202).end(JSON.stringify(data));
    } else {
      const path = new URL(req.url, 'http://127.0.0.1');
      assert.match(path.pathname, /^\/api\/relay\/requests\/r_\d+$/);
      res.writeHead(200).end(JSON.stringify(requests.get(path.pathname.split('/').at(-1))));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = makeRelayClient({ token: 'relay_fixture', base: `http://127.0.0.1:${server.address().port}` });
  assert.deepEqual((await syncRelay(root, { client })).counts, { sent: 1, queued: 1 });
  assert.equal(posted[0].waitSec, 0);
  assert.deepEqual(posted[0].choices, ['Yes', 'No']);
  assert.ok(posted.every(q => q.dedupeKey));
  assert.notEqual(posted[0].dedupeKey, posted[1].dedupeKey);
  await syncRelay(root, { client, pollIntervalMs: 0 });
  assert.equal(posted.length, 2);
  requests.get('r_1').status = 'answered';
  requests.get('r_1').answer = { text: '2', choiceIndex: 1, choice: 'No', via: 'quote' };
  requests.get('r_2').status = 'answered';
  requests.get('r_2').answer = { text: '2027-02-01', via: 'code' };
  await syncRelay(root, { client, wait: 25 });
  const state = readState(root);
  assert.equal(state.jobs[key].status, 'ready');
  assert.deepEqual(state.answers.map(a => a.value), ['No', '2027-02-01']);
  assert.ok(state.answers.every(a => a.scope === 'job' && a.target === key));
  await syncRelay(root, { client });
  assert.equal(readState(root).answers.length, 2);
});

test('timeout and unavailable replies preserve the question and create no answer', async t => {
  const { root, key } = await waiting(t, [{ text: 'Can you relocate?' }]);
  let asks = 0;
  const client = { ask: async () => ({ id: 'r_fixture', status: (++asks, 'sent') }), poll: async () => ({ id: 'r_fixture', status: 'timeout', answer: null }) };
  await syncRelay(root, { client });
  assert.equal((await syncRelay(root, { client, pollIntervalMs: 0 })).fallback, true);
  await syncRelay(root, { client });
  const state = readState(root);
  assert.equal(state.jobs[key].status, 'waiting');
  assert.equal(state.jobs[key].questions[0].relay.status, 'timeout');
  assert.equal(state.answers.length, 0); assert.equal(asks, 1);
});

test('a superseded QQ request is cancelled when the user answers locally', async t => {
  const { root, key } = await waiting(t, [{ text: 'Can you relocate?' }]);
  let cancelled;
  const client = { ask: async () => ({ id: 'r_fixture', status: 'sent' }), cancel: async id => (cancelled = id, { status: 'cancelled' }) };
  await syncRelay(root, { client });
  await changeState(root, state => rememberAnswer(state, { job: state.jobs[key], question: 'Can you relocate?', value: 'Yes', confirmed: true }));
  await syncRelay(root, { client });
  assert.equal(cancelled, 'r_fixture');
  assert.equal(readState(root).jobs[key].questions[0].relay.status, 'cancelled');
});

test('two jobs can share one pending QQ question and resume from its verified reply', async t => {
  const { root, key } = await waiting(t, [{ text: 'In which country/region do you have citizenship?' }]);
  const other = 'https://jobs.example/2';
  await changeState(root, state => {
    state.jobs[other] = { key: other, status: 'waiting', company: 'Other', questions: [{ text: 'What is your country of citizenship?' }] };
  });
  let asks = 0;
  const client = {
    ask: async () => { asks++; return { id: 'r_fixture', status: 'sent' }; },
    poll: async () => ({ id: 'r_fixture', status: 'answered', answer: { text: 'Canada', via: 'quote' } }),
  };
  const first = await syncRelay(root, { client });
  assert.deepEqual(first.counts, { sent: 1, covered: 1 });
  assert.equal(first.fallback, false);
  await syncRelay(root, { client, pollIntervalMs: 0 });
  const state = readState(root);
  assert.equal(asks, 1);
  assert.equal(state.jobs[key].status, 'ready');
  assert.equal(state.jobs[other].status, 'ready');
  assert.equal(state.answers.length, 1);
});

test('ambiguous delivery is held, and offer replies retain provenance for expiry review', async t => {
  const { root, key } = await waiting(t, [{ text: 'Can you travel?' }, { text: 'Other offer deadline?' }, { text: 'Email verification code?' }]);
  let asks = 0;
  const client = { ask: async () => {
    if (++asks === 1) throw Error('Lost relay response');
    return { id: 'r_offer', status: 'answered', answer: { text: '2027-01-05', via: 'quote' } };
  } };
  assert.equal((await syncRelay(root, { client })).fallback, true);
  await syncRelay(root, { client }); await syncRelay(root, { client });
  const state = readState(root), [unknown, deadline, credential] = state.jobs[key].questions;
  assert.equal(unknown.relay.status, 'dispatch_unknown');
  assert.equal(deadline.relay.reply.value, '2027-01-05');
  assert.equal(deadline.relay.reply.request_id, 'r_offer');
  assert.equal(credential.relay, undefined);
  assert.equal(state.answers.length, 0); assert.equal(asks, 2);
});
