import { GoogleAuth, IdentityPoolClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/functions/oidc";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { config, required } from "../config";
import { AppError } from "../errors";
let auth: GoogleAuth | undefined;
export function googleAuth() {
  if (auth) return auth;
  const { project } = config();
  if (process.env.VERCEL) {
    const email = required("GCP_SERVICE_ACCOUNT_EMAIL"),
      audience = required("GCP_WIF_AUDIENCE");
    const authClient = new IdentityPoolClient({
      audience,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`,
      subject_token_supplier: {
        getSubjectToken: async () => getVercelOidcToken(),
      },
    });
    auth = new GoogleAuth({
      projectId: project,
      authClient,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  } else
    auth = new GoogleAuth({
      projectId: project,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  return auth;
}
let database: Firestore | undefined;
let storage: Storage | undefined;
export function db() {
  if (!database) {
    const c = config();
    database = new Firestore({
      projectId: c.project,
      databaseId: c.database,
      auth: googleAuth(),
      ignoreUndefinedProperties: true,
    });
  }
  return database;
}
export function bucket() {
  storage ??= new Storage({
    projectId: config().project,
    authClient: googleAuth(),
  });
  return storage.bucket(config().bucket);
}
export function objectPath(projectId: string, versionId: string, name: string) {
  for (const x of [projectId, versionId, name])
    if (!/^[a-zA-Z0-9_.-]+$/.test(x) || x.includes(".."))
      throw new AppError("PATH", "Ruta inválida");
  return `${config().prefix}/${projectId}/${versionId}/${name}`;
}
export function privateObject(key: string) {
  if (
    !key.startsWith(config().prefix + "/") ||
    key.includes("..") ||
    key.includes("\\")
  )
    throw new AppError("PATH", "Objeto fuera del prefijo");
  return bucket().file(key);
}
export async function signedUrl(key: string) {
  const [url] = await privateObject(key).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 5 * 60000,
  });
  return url;
}
export async function googlePost(url: string, body: unknown, paid = false) {
  const token = await googleAuth().getAccessToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    throw new AppError(
      paid ? "AMBIGUOUS" : "PROVIDER_NETWORK",
      paid
        ? "El proveedor pudo aceptar la solicitud. No se generará otra automáticamente."
        : "No se pudo consultar al proveedor.",
      502,
    );
  }
  if (!res.ok) {
    const code =
      res.status === 429
        ? "QUOTA"
        : res.status === 401 || res.status === 403
          ? "PROVIDER_AUTH"
          : res.status >= 500 && paid
            ? "AMBIGUOUS"
            : "PROVIDER_REJECTED";
    throw new AppError(
      code,
      `Google respondió ${res.status}. ${code === "AMBIGUOUS" ? "Reconciliar antes de repetir." : "Revisa acceso, cuota o parámetros del modelo."}`,
      502,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new AppError(
      paid ? "AMBIGUOUS" : "PROVIDER_RESPONSE",
      "Respuesta incompleta del proveedor.",
      502,
    );
  }
}
