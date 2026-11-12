import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command } from '../lean-apply.mjs';
import { changeState, readState, rememberAnswer, claimNext, setJob, retryJob } from '../lib/lean-apply.mjs';
import { loadRelayConfig, makeRelayClient, syncRelay, isSkipJobReply } from '../lib/lean-relay.mjs';

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
  const first = await syncRelay(root, { client });
  assert.deepEqual(first.counts, { sent: 1, covered_job: 1 });
  assert.equal(first.fallback, false);
  assert.equal(posted[0].waitSec, 0);
  assert.match(posted[0].text, /\/skip-job/);
  assert.deepEqual(posted[0].choices, ['Yes', 'No']);
  assert.ok(posted.every(q => q.dedupeKey));
  await syncRelay(root, { client, pollIntervalMs: 0 });
  assert.equal(posted.length, 1);
  requests.get('r_1').status = 'answered';
  requests.get('r_1').answer = { text: '2', choiceIndex: 1, choice: 'No', via: 'quote' };
  await syncRelay(root, { client, wait: 25 });
  assert.equal(posted.length, 2);
  assert.notEqual(posted[0].dedupeKey, posted[1].dedupeKey);
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

test('only exact stop commands match; ordinary negative answers and quoted instructions do not', () => {
  for (const value of ['/skip-job', ' /SKIP-JOB ', '不投递这个岗位。', '不投这个岗位', '这个岗位不投了', '跳过这个岗位', '放弃这个岗位']) assert.equal(isSkipJobReply(value), true, value);
  for (const value of ['No', '没有', '我不想跳过这个岗位', '不要不投递这个岗位', '请解释 /skip-job', '/skip-job other job', '#abcd /skip-job', null]) assert.equal(isSkipJobReply(value), false, String(value));
});

test('a QQ stop cancels all pending questions for only that job, even inside the same batch', async t => {
  const { root, key } = await waiting(t, [
    { id: 'one', text: 'Can you travel?', relay: { id: 'r_stop', status: 'sent' } },
    { id: 'two', text: 'Preferred location?', relay: { id: 'r_queued', status: 'queued' } },
    { id: 'three', text: 'Another required fact?' },
    { id: 'four', text: 'Need employer confirmation', audience: 'employer', relay: { id: 'r_policy', status: 'queued' } },
  ]);
  const other = 'https://jobs.example/2', cancelled = [], asks = [];
  await changeState(root, state => { state.jobs[other] = { key: other, status: 'waiting', company: 'Other', title: 'Engineer', questions: [{ text: 'Can you travel?' }] }; });
  const client = {
    poll: async id => { assert.equal(id, 'r_stop'); return { id, status: 'answered', answer: { text: '/skip-job', via: 'quote' } }; },
    cancel: async id => { cancelled.push(id); return { id, status: 'cancelled' }; },
    ask: async body => { asks.push(body); return { id: 'r_other', status: 'sent' }; },
  };
  const result = await syncRelay(root, { client, pollIntervalMs: 0 });
  const state = readState(root);
  assert.deepEqual(result.skipped_jobs, [key]);
  assert.equal(state.jobs[key].status, 'skipped');
  assert.equal(state.jobs[key].claim, undefined);
  assert.equal(state.jobs[key].user_skip.request_id, 'r_stop');
  assert.deepEqual(new Set(cancelled), new Set(['r_queued', 'r_policy']));
  assert.equal(asks.length, 1); assert.match(asks[0].text, /Other/);
  assert.equal(state.jobs[key].questions[2].relay, undefined);
  assert.equal(state.jobs[other].status, 'waiting');
  assert.equal(state.answers.length, 0);
  const again = await syncRelay(root, { client, pollIntervalMs: 60000 });
  assert.equal(again.fallback, false); assert.equal(asks.length, 1);
});

test('a skipped shared-fact question does not suppress that fact for another job', async t => {
  const { root, key } = await waiting(t, [{ text: 'In which country/region do you have citizenship?', relay: { id: 'r_stop', status: 'sent' } }]);
  const other = 'https://jobs.example/2';
  await changeState(root, state => { state.jobs[other] = { key: other, status: 'waiting', company: 'Other', questions: [{ text: 'What is your country of citizenship?' }] }; });
  let asks = 0;
  const client = {
    poll: async id => ({ id, status: 'answered', answer: { text: '不投递这个岗位', via: 'code' } }),
    ask: async () => (++asks, { id: 'r_other', status: 'sent' }),
  };
  await syncRelay(root, { client, pollIntervalMs: 0 });
  assert.equal(asks, 1); assert.equal(readState(root).jobs[key].status, 'skipped');
  assert.equal(readState(root).jobs[other].questions[0].relay.id, 'r_other');
});

test('a late stop outranks a reused answer and survives cancellation failure and a fresh read', async t => {
  const { root, key } = await waiting(t, [
    { text: 'Can you relocate?', relay: { id: 'r_stop', status: 'sent' } },
    { text: 'Preferred location?', relay: { id: 'r_pending', status: 'queued' } },
  ]);
  await changeState(root, state => { state.jobs[key].status = 'working'; state.enabled = true; });
  let fail = true;
  const client = { cancel: async id => {
    if (id === 'r_stop') return { id, status: 'answered', answer: { text: '/skip-job', via: 'code' } };
    if (fail) throw Error('Fixture temporary outage');
    return { id, status: 'cancelled' };
  } };
  assert.equal((await syncRelay(root, { client, existingOnly: true, jobKey: key })).status, 'unavailable');
  assert.equal(readState(root).jobs[key].status, 'skipped');
  await assert.rejects(setJob(root, key, 'fixture', 'submitting'), /User skipped/);
  await assert.rejects(setJob(root, key, 'fixture', 'waiting', { questions: [{ text: 'New question?' }] }), /User skipped/);
  await assert.rejects(retryJob(root, key, true), /resume-user-skipped/);
  await changeState(root, state => rememberAnswer(state, { job: state.jobs[key], question: 'Can you relocate?', value: 'Yes', confirmed: true }));
  assert.equal(readState(root).jobs[key].status, 'skipped');
  fail = false;
  await syncRelay(root, { client, existingOnly: true });
  assert.equal(readState(root).jobs[key].questions[1].relay.status, 'cancelled');
  assert.equal((await claimNext(root)).job, null);
  assert.equal(readState(root).answers.some(a => a.value === '/skip-job'), false);
});

test('stop replies preserve an in-flight or employer-confirmed submission and uncorrelated text is ignored', async t => {
  const { root, key } = await waiting(t, [{ text: 'Any remaining fact?', relay: { id: 'r_stop', status: 'sent' } }]);
  await changeState(root, state => { state.jobs[key].status = 'submitting'; state.enabled = true; });
  const client = { cancel: async id => ({ id, status: 'answered', answer: { text: '/skip-job', via: 'quote' } }) };
  await syncRelay(root, { client, existingOnly: true });
  assert.equal(readState(root).jobs[key].status, 'submitting');
  assert.ok(readState(root).jobs[key].user_skip);
  await setJob(root, key, 'fixture', 'submitted', { evidence: { kind: 'confirmation_page', job_url: key, confirmation_url: 'https://jobs.example/confirmed', text: 'Application received' } });
  assert.equal(readState(root).jobs[key].status, 'submitted');
  const other = await waiting(t, [{ text: 'Can you travel?' }]);
  await syncRelay(other.root, { client: { ask: async () => ({ id: 'r_invalid', status: 'answered', answer: { text: '/skip-job', via: 'unknown' } }) } });
  assert.equal(readState(other.root).jobs[other.key].status, 'waiting');
  assert.equal(readState(other.root).answers.length, 0);
});

test('submit intent checks a late QQ stop over HTTP and refuses submission during a relay outage', async t => {
  const { root, key } = await waiting(t, [{ text: 'Can you travel?', relay: { id: 'r_late', status: 'sent' } }]);
  await changeState(root, state => { state.enabled = true; state.jobs[key].status = 'working'; });
  let outage = true, requests = 0;
  const server = http.createServer((req, res) => {
    requests++; assert.equal(req.url, '/api/relay/requests/r_late/cancel');
    if (outage) { res.writeHead(503).end(JSON.stringify({ ok: false })); return; }
    res.writeHead(200).end(JSON.stringify({ ok: true, id: 'r_late', status: 'answered', answer: { text: '不投递这个岗位', via: 'code' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const saved = Object.fromEntries(['DSH_OMNI_RELAY_TOKEN', 'DSH_OMNI_RELAY_URL'].map(key => [key, process.env[key]]));
  t.after(() => {
    server.closeAllConnections(); server.close();
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  process.env.DSH_OMNI_RELAY_TOKEN = 'relay_fixture';
  process.env.DSH_OMNI_RELAY_URL = `http://127.0.0.1:${server.address().port}`;
  const args = ['submit-intent', '--job', key, '--claim', 'fixture'];
  await assert.rejects(command(args, root), /could not be synchronized/);
  assert.equal(readState(root).jobs[key].status, 'working');
  outage = false;
  await assert.rejects(command(args, root), /User skipped/);
  assert.equal(readState(root).jobs[key].status, 'skipped');
  assert.equal(requests, 2);
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

test('existing-only sync retires a resolved default and collects old replies without new asks', async t => {
  const { root, key } = await waiting(t, [
    { text: 'Are you open to relocation?', relay: { id:'r_move',status:'queued' } },
    { text: 'Can you travel?', relay: { id:'r_travel',status:'sent' } },
    { text: 'Preferred start date?' },
  ]);
  await changeState(root,state=>{state.form_defaults={relocation:true};});
  const cancelled = [];
  const client = {
    cancel: async id => { cancelled.push(id); return {status:'cancelled'}; },
    poll: async id => ({id,status:'answered',answer:{text:'Yes',via:'quote'}}),
    ask: async () => { throw Error('Unexpected new question'); },
  };
  const result = await syncRelay(root,{client,existingOnly:true});
  assert.equal(result.retired,1);
  assert.equal(result.counts.answered,1);
  assert.equal(result.fallback,false);
  assert.deepEqual(cancelled,['r_move']);
  assert.equal(readState(root).jobs[key].questions[2].relay,undefined);
});

test('employer sponsorship evidence stays pending locally and is retired from QQ', async t => {
  const { root, key } = await waiting(t, [
    { text: 'Does this Annapurna Labs role support future H-1B sponsorship?', relay: { id: 'r_employer', status: 'queued' } },
    { text: 'Need a company confirmation', audience: 'employer' },
  ]);
  let cancelled;
  const client = { cancel: async id => { cancelled = id; return { status: 'cancelled' }; }, ask: async () => { throw Error('Unexpected QQ question'); } };
  const result = await syncRelay(root, { client });
  assert.equal(cancelled, 'r_employer');
  assert.equal(result.employer_checks, 2);
  assert.equal(result.fallback, false);
  assert.equal(readState(root).jobs[key].status, 'waiting');
});

test('a terminal cancel acknowledgement without a body is checked by request ID', async () => {
  const paths = [];
  const client = makeRelayClient({ base:'http://127.0.0.1:3100', token:'relay_fixture' }, async (url, options) => {
    paths.push([options.method, new URL(url).pathname]);
    const data = options.method === 'POST' ? {ok:true} : {ok:true,id:'r_previous',status:'answered',answer:{text:'No',via:'quote'}};
    return Response.json(data);
  });
  assert.equal((await client.cancel('r_previous')).status,'answered');
  assert.deepEqual(paths,[['POST','/api/relay/requests/r_previous/cancel'],['GET','/api/relay/requests/r_previous']]);
});

test('ambiguous delivery is held, and offer replies retain provenance for expiry review', async t => {
  const { root, key } = await waiting(t, [{ text: 'Can you travel?' }, { text: 'Email verification code?' }]);
  const other = 'https://jobs.example/offer';
  await changeState(root, state => { state.jobs[other] = { key: other, status: 'waiting', company: 'Other', questions: [{ text: 'Other offer deadline?' }] }; });
  let asks = 0;
  const client = { ask: async () => {
    if (++asks === 1) throw Error('Lost relay response');
    return { id: 'r_offer', status: 'answered', answer: { text: '2027-01-05', via: 'quote' } };
  } };
  assert.equal((await syncRelay(root, { client })).fallback, true);
  await syncRelay(root, { client }); await syncRelay(root, { client });
  const state = readState(root), [unknown, credential] = state.jobs[key].questions, [deadline] = state.jobs[other].questions;
  assert.equal(unknown.relay.status, 'dispatch_unknown');
  assert.equal(deadline.relay.reply.value, '2027-01-05');
  assert.equal(deadline.relay.reply.request_id, 'r_offer');
  assert.equal(credential.relay, undefined);
  assert.equal(state.answers.length, 0); assert.equal(asks, 2);
});
