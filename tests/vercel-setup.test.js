import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ home: '', calls: [], wrong: false, fail: false }));
vi.mock('node:os', async (original) => ({ ...await original(), homedir: () => state.home }));
vi.mock('node:child_process', () => ({ spawnSync: (_cmd, args, options) => {
 state.calls.push({ args, input: options.input });
 const path = args[3];
 let data = {};
 if (path === '/v9/projects/universos-ia') data = { name: 'universos-ia', id: 'prj_test', accountId: 'team_test', link: { org: 'Alixonveloz1-ctrl', repo: state.wrong ? 'wrong' : 'Universos-IA' } };
 if (path?.endsWith('/domains')) data = { domains: [{ name: 'universos-ia.vercel.app' }] };
 if (path?.includes('/env?')) data = state.fail ? { failed: [{ error: 'rejected' }] } : { created: { key: JSON.parse(options.input).key }, failed: [] };
 return { status: 0, stdout: JSON.stringify(data) };
} }));
import { configure, values } from '../scripts/configure-vercel.mjs';
beforeEach(() => {
 state.home = mkdtempSync(join(tmpdir(), 'universos-vercel-test-'));
 state.calls = []; state.wrong = false; state.fail = false;
 vi.spyOn(console, 'log').mockImplementation(() => {});
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'set-cookie': '__Host-universos=test' } })));
});
afterEach(() => { rmSync(state.home, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test('SIMULATED: configures 14 production vars through stdin, redeploys and checks actual session route', async () => {
 await configure();
 const writes = state.calls.filter(c => c.args[3]?.includes('/env?'));
 expect(writes).toHaveLength(14);
 for (const c of writes) {
  const data = JSON.parse(c.input);
  expect(data.target).toEqual(['production']);
  expect(data.value.length).toBeGreaterThan(0);
  expect(c.args).toContain('--input');
  expect(c.args).not.toContain(data.value);
 }
 expect(state.calls.at(-1).args).toContain('redeploy');
 expect(fetch.mock.calls[0][0]).toBe('https://universos-ia.vercel.app/api/session');
 const first = writes.find(c => JSON.parse(c.input).key === 'APP_PASSWORD_HASH').input;
 await configure();
 expect(state.calls.filter(c => c.args[3]?.includes('/env?')).filter(c => JSON.parse(c.input).key === 'APP_PASSWORD_HASH')[1].input).toBe(first);
});
test('SIMULATED: wrong repository stops before changes', async () => {
 state.wrong = true;
 await expect(configure()).rejects.toThrow('repositorio');
 expect(state.calls).toHaveLength(1);
});
test('SIMULATED: rejected variable prevents redeploy', async () => {
 state.fail = true;
 await expect(configure()).rejects.toThrow('no completó');
 expect(state.calls.some(c => c.args.includes('redeploy'))).toBe(false);
});
test('all 14 template keys receive a value', () => {
 expect(Object.keys(values({ hash: 'hash', session: 'session' }))).toHaveLength(14);
});
