import { spawnSync } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// No real project, bucket, service account, WIF audience, team or origin
// belongs in this file. Everything private comes from the environment,
// which is set in Vercel / Cloud Shell, never committed to Git.
// Required: VERCEL_TEAM_SLUG, VERCEL_PROJECT_NAME, APP_ORIGIN,
// GCP_PROJECT_ID, GCS_OUTPUT_BUCKET, CLOUD_RUN_JOB_RESOURCE,
// GCP_SERVICE_ACCOUNT_EMAIL, GCP_WIF_AUDIENCE.
// Optional: GCS_PREFIX, FIRESTORE_DATABASE_ID, DIRECTOR_MODEL,
// IMAGE_MODEL, VIDEO_MODEL, MAX_ACTIVE_JOBS, GITHUB_ORG, GITHUB_REPO.
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw Error(`Falta la variable ${name} en el entorno. Configúrala en Vercel o en Cloud Shell y vuelve a ejecutar ./v. No se ha modificado nada.`);
  return value;
}
const getScope = () => required('VERCEL_TEAM_SLUG');
const getName = () => process.env.VERCEL_PROJECT_NAME?.trim() || 'universos-ia';
const getOrigin = () => required('APP_ORIGIN');
const getGithubOrg = () => process.env.GITHUB_ORG?.trim() || 'Alixonveloz1-ctrl';
const getGithubRepo = () => process.env.GITHUB_REPO?.trim() || 'Universos-IA';
const root = fileURLToPath(new URL('../', import.meta.url));
function cli(args, input, visible = false) {
 const r = spawnSync('npx', ['--yes', 'vercel@60.1.3', ...args, '--scope', getScope()], {
  cwd: root, encoding: 'utf8', input,
  stdio: visible ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
 });
 if (r.status !== 0) throw Error(`Falló Vercel (${args[0]}). Comprueba tu autorización y vuelve a ejecutar ./v. No se muestran respuestas privadas.`);
 return r.stdout || '';
}
function api(path, method = 'GET', data) {
 const args = ['api', path, '--method', method, '--raw'];
 if (data !== undefined) args.push('--input', '-');
 const result = JSON.parse(cli(args, data === undefined ? undefined : JSON.stringify(data)));
 if (result.error || result.failed?.length) throw Error('Vercel no completó la configuración. No se iniciará el redeploy.');
 return result;
}
export function values(credentials) {
 return {
  GCP_PROJECT_ID: required('GCP_PROJECT_ID'),
  GCS_OUTPUT_BUCKET: required('GCS_OUTPUT_BUCKET'),
  GCS_PREFIX: process.env.GCS_PREFIX?.trim() || 'universos-ia',
  FIRESTORE_DATABASE_ID: process.env.FIRESTORE_DATABASE_ID?.trim() || '(default)',
  CLOUD_RUN_JOB_RESOURCE: required('CLOUD_RUN_JOB_RESOURCE'),
  APP_ORIGIN: getOrigin(), APP_PASSWORD_HASH: credentials.hash, SESSION_SECRET: credentials.session,
  GCP_SERVICE_ACCOUNT_EMAIL: required('GCP_SERVICE_ACCOUNT_EMAIL'),
  GCP_WIF_AUDIENCE: required('GCP_WIF_AUDIENCE'),
  DIRECTOR_MODEL: process.env.DIRECTOR_MODEL?.trim() || 'gemini-3-flash-preview',
  IMAGE_MODEL: process.env.IMAGE_MODEL?.trim() || 'gemini-3.1-flash-image',
  VIDEO_MODEL: process.env.VIDEO_MODEL?.trim() || 'veo-3.1-lite-generate-001',
  MAX_ACTIVE_JOBS: process.env.MAX_ACTIVE_JOBS?.trim() || '1',
 };
}
export async function configure() {
 console.log('Comprobando el proyecto y dominio de Universos IA…');
 const name = getName();
 const origin = getOrigin();
 const githubOrg = getGithubOrg();
 const githubRepo = getGithubRepo();
 const project = api(`/v9/projects/${name}`);
 if (project.name !== name || !project.id || !project.accountId ||
     project.link?.org !== githubOrg || project.link?.repo !== githubRepo)
  throw Error('El proyecto no corresponde al repositorio Universos-IA. No se ha modificado nada.');
 const domains = api(`/v9/projects/${project.id}/domains`);
 if (!domains.domains?.some(d => d.name === new URL(origin).hostname))
  throw Error('El dominio esperado no pertenece al proyecto. No se ha modificado nada.');
 // APP_PASSWORD en texto plano tiene prioridad sobre APP_PASSWORD_HASH, así que
 // si queda en Production la contraseña nueva de ./v nunca abriría la web.
 // Por eso ./v la elimina antes de poner las 14 variables, no a mano.
 const existing = api(`/v9/projects/${project.id}/env`);
 for (const env of existing.envs || []) {
  if (env.key === 'APP_PASSWORD' && env.target?.includes('production')) {
   api(`/v9/projects/${project.id}/env/${env.id}`, 'DELETE');
   console.log('Eliminada: APP_PASSWORD (contraseña antigua en texto plano)');
  }
 }
 // Saved outside the repository so interrupted runs reuse the same new password.
 const privateDir = join(homedir(), '.config', 'universos-ia');
 mkdirSync(privateDir, { recursive: true, mode: 0o700 });
 chmodSync(privateDir, 0o700);
 const credentialFile = join(privateDir, `${project.id}-access.json`);
 let credentials;
 if (existsSync(credentialFile)) credentials = JSON.parse(readFileSync(credentialFile, 'utf8'));
 else {
  const password = randomBytes(18).toString('base64url');
  const salt = randomBytes(32).toString('hex');
  credentials = { password, hash: `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`, session: randomBytes(48).toString('base64url') };
  writeFileSync(credentialFile, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
 }
 chmodSync(credentialFile, 0o600);
 if (!credentials.password || !credentials.hash?.startsWith('scrypt:') || credentials.session?.length < 32)
  throw Error('El archivo privado de acceso está incompleto.');
 console.log('Configurando la conexión con Google Cloud…');
 api(`/v9/projects/${project.id}`, 'PATCH', { oidcTokenConfig: { enabled: true, issuerMode: 'team' } });
 const env = values(credentials);
 for (const [key, value] of Object.entries(env)) {
  const result = api(`/v10/projects/${project.id}/env?upsert=true`, 'POST', {
   key, value, type: 'encrypted', target: ['production'],
  });
  if (!result.created) throw Error(`No se confirmó la variable ${key}.`);
  console.log(`Configurada: ${key}`);
 }
 console.log('Las 14 variables están configuradas. Publicando la nueva versión…');
 cli(['redeploy', origin, '--target', 'production'], undefined, true);
 console.log(`\nWeb: ${origin}`);
 console.log('Tu NUEVA contraseña para entrar (guárdala; no compartas esta pantalla):');
 console.log(credentials.password);
 console.log('Comprobando conexión y acceso, sin generar videos…');
 let ok = false;
 for (let attempt = 0; attempt < 6; attempt++) {
  const response = await fetch(`${origin}/api/session`, {
   method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
   body: JSON.stringify({ password: credentials.password }), signal: AbortSignal.timeout(30000),
  });
  if (response.ok && response.headers.get('set-cookie')?.includes('__Host-universos=')) { ok = true; break; }
  if (response.status !== 503 && response.status !== 502) break;
  await new Promise(resolve => setTimeout(resolve, 10000));
 }
 if (!ok) throw Error('El redeploy terminó, pero la comprobación de acceso no pasó. Guarda la contraseña y comparte solo este mensaje, no los valores privados.');
 console.log('Acceso y conexión con la base de datos verificados. Puedes abrir tu web.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
 configure().catch(error => { console.error(error.message); process.exitCode = 1; });
}
