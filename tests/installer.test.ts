import { afterEach, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
// SIMULATED gcloud only: validates orchestration and fail-closed configuration.
// No Google account, resource, credential, or paid model is used by these tests.
function setup(overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "universos-installer-")); dirs.push(dir);
  const log = path.join(dir, "calls.jsonl");
  writeFileSync(path.join(dir, "gcloud"), `#!/usr/bin/env python3
import os, sys, json, pathlib
a=sys.argv[1:]; cmd=' '.join(a); e=os.environ
with open(e['INSTALLER_TEST_LOG'],'a') as f: f.write(json.dumps(a)+'\\n')
p=e['GCP_PROJECT_ID']; n='123456789'; region=e['GCP_REGION']
if cmd.startswith('auth list'): print('simulated@example.invalid')
elif cmd.startswith('projects describe'): print(n if 'projectNumber' in cmd else p)
elif cmd.startswith('firestore databases list'):
 if not e.get('INSTALLER_TEST_NEW'): print('projects/'+p+'/databases/(default)')
elif cmd.startswith('firestore databases describe'): print('FIRESTORE_NATIVE')
elif cmd.startswith('storage buckets list'):
 if not e.get('INSTALLER_TEST_NEW'): print(e['GCS_OUTPUT_BUCKET'])
elif cmd.startswith('storage buckets describe'):
 print(json.dumps({'projectNumber': '999' if e.get('INSTALLER_TEST_FOREIGN') else n, 'iamConfiguration': {'publicAccessPrevention':'enforced','uniformBucketLevelAccess': {'enabled':not bool(e.get('INSTALLER_TEST_PUBLIC'))}}}))
elif cmd.startswith('iam service-accounts list'):
 if not e.get('INSTALLER_TEST_NEW'):
  for k in ['WORKER_ACCOUNT','WEB_ACCOUNT','BUILD_ACCOUNT']: print(e[k]+'@'+p+'.iam.gserviceaccount.com')
elif cmd.startswith('iam roles list'):
 if not e.get('INSTALLER_TEST_NEW'):
  for r in ['universosJobExecutor','universosObjectLister']: print('projects/'+p+'/roles/'+r)
elif cmd.startswith('artifacts repositories list'):
 if not e.get('INSTALLER_TEST_NEW'): print('projects/'+p+'/locations/'+region+'/repositories/'+e['ARTIFACT_REPOSITORY'])
elif cmd.startswith('artifacts repositories describe'): print('DOCKER')
elif cmd.startswith('iam workload-identity-pools providers list'):
 if not e.get('INSTALLER_TEST_NEW'): print('projects/'+n+'/locations/global/workloadIdentityPools/'+e['WIF_POOL']+'/providers/'+e['WIF_PROVIDER'])
elif cmd.startswith('iam workload-identity-pools providers describe'):
 team=e['VERCEL_TEAM_SLUG']; sub='owner:'+team+':project:'+e['VERCEL_PROJECT_NAME']+':environment:production'
 print(json.dumps({'state':'ACTIVE','oidc':{'issuerUri':'https://oidc.vercel.com/'+team,'allowedAudiences':['https://vercel.com/'+team]},'attributeMapping':{'google.subject':'assertion.sub'},'attributeCondition':'true' if e.get('INSTALLER_TEST_WIF') else "assertion.sub=='"+sub+"'"}))
elif cmd.startswith('iam workload-identity-pools list'):
 if not e.get('INSTALLER_TEST_NEW'): print('projects/'+n+'/locations/global/workloadIdentityPools/'+e['WIF_POOL'])
elif cmd.startswith('builds submit'):
 root=pathlib.Path(a[2]); assert (root/'worker/media.ts').is_file(); assert (root/'lib/models.ts').is_file()
 assert 'ffmpeg' in (root/'Dockerfile').read_text()
 assert 'CLOUD_LOGGING_ONLY' in (root/'cloudbuild.yaml').read_text()
`, { mode: 0o700 });
  const env = { ...process.env, PATH: dir + path.delimiter + process.env.PATH,
    GCP_PROJECT_ID: "example-project", GCP_REGION: "us-central1", GCS_OUTPUT_BUCKET: "example-private-bucket",
    WORKER_ACCOUNT: "universos-worker", WEB_ACCOUNT: "universos-web", BUILD_ACCOUNT: "universos-build",
    CLOUD_RUN_JOB_NAME: "universos-worker", ARTIFACT_REPOSITORY: "universos-ia",
    VERCEL_TEAM_SLUG: "example-team", VERCEL_PROJECT_NAME: "universos-ia", WIF_POOL: "universos-vercel", WIF_PROVIDER: "vercel",
    INSTALLER_TEST_LOG: log, ...overrides };
  const run = () => spawnSync("bash", [path.resolve("install.sh")], { cwd: dir, env, encoding: "utf8", timeout: 20000 });
  const calls = () => { try { return readFileSync(log, "utf8").trim().split("\n").map((s) => JSON.parse(s) as string[]); } catch { return []; } };
  return { run, calls };
}

test("SIMULATED installer: fresh install includes assembler, isolated builder and no generations", () => {
  const s = setup({ INSTALLER_TEST_NEW: "1" }); const r = s.run();
  expect(r.status, r.stderr).toBe(0);
  const calls = s.calls();
  expect(calls.filter((a) => a.slice(0, 3).join(" ") === "storage buckets create")).toHaveLength(1);
  const build = calls.find((a) => a[0] === "builds" && a[1] === "submit")!;
  expect(build).toContain("--service-account=projects/example-project/serviceAccounts/universos-build@example-project.iam.gserviceaccount.com");
  expect(build).toContain("--gcs-source-staging-dir=gs://example-private-bucket/universos-ia/build/source");
  expect(calls.some((a) => a.slice(0, 3).join(" ") === "run jobs deploy")).toBe(true);
  expect(calls.some((a) => a.includes("execute") || a.includes("roles/owner") || a.includes("roles/editor"))).toBe(false);
  expect(r.stdout).toContain("GCP_PROJECT_ID=example-project");
});
test("SIMULATED installer: repeat updates one job without recreating persistent resources", () => {
  const s = setup();
  for (let i = 0; i < 2; i++) { const r = s.run(); expect(r.status, r.stderr).toBe(0); }
  expect(s.calls().some((a) => a.includes("create") || a.includes("delete"))).toBe(false);
  expect(s.calls().filter((a) => a.slice(0, 3).join(" ") === "run jobs deploy")).toHaveLength(2);
});
test.each(["INSTALLER_TEST_PUBLIC", "INSTALLER_TEST_FOREIGN"])("SIMULATED installer: rejects unsafe bucket (%s) before building", (flag) => {
  const s = setup({ [flag]: "1" }); expect(s.run().status).not.toBe(0);
  expect(s.calls().some((a) => a[0] === "builds" || a[0] === "run")).toBe(false);
});
test("SIMULATED installer: rejects broader pre-existing WIF trust", () => {
  const s = setup({ INSTALLER_TEST_WIF: "1" }); const r = s.run();
  expect(r.status).not.toBe(0); expect(r.stderr).toContain("WIF existente no coincide");
  expect(s.calls().some((a) => a.includes("--role=roles/iam.workloadIdentityUser"))).toBe(false);
});
test("SIMULATED installer: rejects shared identities before cloud mutations", () => {
  const s = setup({ WEB_ACCOUNT: "universos-worker" }); expect(s.run().status).not.toBe(0); expect(s.calls().every((a) => a[0] === "auth" && a[1] === "list")).toBe(true);
});
