import { GoogleAuth, IdentityPoolClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/functions/oidc";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { config, required } from "../config";
import { AppError } from "../errors";
import { scopedDatabase } from "./scope";
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
  return scopedDatabase(database);
}
export function bucket() {
  storage ??= new Storage({
    projectId: config().project,
    authClient: googleAuth(),
  });
  return storage.bucket(config().bucket);
}
export function readableFolderName(title: string, id: string) {
  const safe = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90) || "proyecto";
  if (!/^[a-zA-Z0-9_.-]+$/.test(id) || id.includes(".."))
    throw new AppError("PATH", "ID de proyecto inválido");
  return `${safe}--${id}`;
}
export function projectObjectPath(title: string, projectId: string, chapterNumber: number, versionId: string, name: string) {
  for (const x of [versionId, name])
    if (!/^[a-zA-Z0-9_.-]+$/.test(x) || x.includes(".."))
      throw new AppError("PATH", "Ruta inválida");
  const chapter = Math.max(1, Math.trunc(chapterNumber || 1));
  return `${config().prefix}/proyectos/${readableFolderName(title, projectId)}/capitulo-${chapter}/${versionId}/${name}`;
}
export function directVideoObjectPath(id: string, name: string) {
  for (const x of [id, name])
    if (!/^[a-zA-Z0-9_.-]+$/.test(x) || x.includes(".."))
      throw new AppError("PATH", "Ruta inválida");
  return `${config().prefix}/video-libre/${id}/${name}`;
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
export async function readPrivateObject(key: string) {
  privateObject(key);
  const token = await googleAuth().getAccessToken();
  const upstream = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config().bucket)}/o/${encodeURIComponent(key)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(600000),
    },
  );
  if (!upstream.ok)
    throw new AppError(
      "STORAGE_READ",
      `No se pudo leer el archivo guardado (Google ${upstream.status}).`,
      upstream.status === 404 ? 404 : 502,
    );
  return Buffer.from(await upstream.arrayBuffer());
}

// Serve private media through the authenticated app. WIF has access tokens,
// not a local signing key or the metadata server expected by getSignedUrl.
export async function mediaResponse(key: string, range: string | null = null) {
  privateObject(key); // Validate the isolated namespace before any request.
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) throw new AppError("RANGE", "Rango inválido", 416);
  const token = await googleAuth().getAccessToken();
  const upstream = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config().bucket)}/o/${encodeURIComponent(key)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity", ...(range ? { Range: range } : {}) },
    signal: AbortSignal.timeout(120000),
  });
  if (!upstream.ok && upstream.status !== 416) throw new AppError("MEDIA_READ", `No se pudo leer el archivo guardado (Google ${upstream.status}). No necesitas regenerarlo.`, upstream.status === 404 ? 404 : 502);
  const headers = new Headers({ "Cache-Control": "private, no-store, no-transform", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
  for (const name of ["content-type", "content-length", "content-range"])
    if (upstream.headers.has(name)) headers.set(name, upstream.headers.get(name)!);
  if (upstream.status === 206) {
    const partial = headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!partial) {
      await upstream.body?.cancel();
      throw new AppError("MEDIA_READ", "No se pudo cargar el video. Vuelve a cargarlo; no necesitas regenerarlo.", 502);
    }
    headers.set("content-length", String(Number(partial[2]) - Number(partial[1]) + 1));
  }
  if (key.toLowerCase().endsWith(".mp4"))
    headers.set("content-type", "video/mp4");
  if (upstream.status === 416) {
    await upstream.body?.cancel();
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }
  // Safari probes with bytes=0-1 and refuses a full 200 response. Some
  // storage responses ignore Range; expose the requested bytes as a 206
  // without buffering a whole clip or sending a second storage request.
  if (range && upstream.status === 200) {
    const size = Number(upstream.headers.get("content-length"));
    const [from, to] = range.slice(6).split("-");
    const start = from ? Number(from) : Math.max(0, size - Number(to));
    const end = from ? (to ? Math.min(Number(to), size - 1) : size - 1) : size - 1;
    if (!upstream.headers.has("content-length") || !Number.isSafeInteger(size) || size < 0) {
      await upstream.body?.cancel();
      throw new AppError("MEDIA_READ", "No se pudo cargar el video. Vuelve a cargarlo; no necesitas regenerarlo.", 502);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      await upstream.body?.cancel();
      headers.set("content-range", `bytes */${size}`);
      headers.set("content-length", "0");
      return new Response(null, { status: 416, headers });
    }
    const reader = upstream.body!.getReader();
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) { controller.error(new Error("Archivo de video incompleto")); return; }
            const chunkStart = offset;
            offset += value.length;
            if (offset <= start) continue;
            controller.enqueue(value.subarray(Math.max(0, start - chunkStart), Math.min(value.length, end + 1 - chunkStart)));
            if (offset > end) { controller.close(); await reader.cancel(); }
            return;
          }
        } catch (error) { controller.error(error); }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(body, { status: 206, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
export async function googlePost(url: string, body: unknown, paid = false, timeoutMs = 120000) {
  const started = Date.now();
  const label = new URL(url).pathname.split("/").pop();
  const token = await googleAuth().getAccessToken();
  console.info("google_request", { operation: label, authenticationMs: Date.now() - started });
  let res: Response;
  const payload = JSON.stringify(body);
  // A 429 is an explicit rejection: Google did not accept a paid generation,
  // so retrying the SAME request is safe. Keep retries serial and bounded to
  // avoid stacking calls or silently changing the selected model.
  const max429Attempts = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Explicitly keep Gemini requests on standard shared PayGo. This
          // header is ignored by services/models where it is not applicable.
          "X-Vertex-AI-LLM-Request-Type": "shared",
        },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const cause = error as { name?: string; cause?: { code?: string } };
      console.error("google_transport_failed", { operation: label, elapsedMs: Date.now() - started, timeoutMs, name: cause?.name, cause: cause?.cause?.code });
      throw new AppError(
        paid ? "AMBIGUOUS" : "PROVIDER_NETWORK",
        paid
          ? "El proveedor pudo aceptar la solicitud. No se generará otra automáticamente."
          : "No se pudo consultar al proveedor.",
        502,
      );
    }
    console.info("google_response", { operation: label, status: res.status, elapsedMs: Date.now() - started, attempt: attempt + 1 });
    if (res.status !== 429 || attempt >= max429Attempts - 1) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30000)
      : Math.min(1500 * 2 ** attempt, 12000);
    console.warn("google_429_retry", { operation: label, attempt: attempt + 1, delayMs });
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  if (!res.ok) {
    // Google's JSON error message identifies invalid models and parameters.
    // Never include request bodies or authentication headers in job errors.
    const detail = await res.json().then((v: { error?: { message?: string } }) =>
      typeof v?.error?.message === "string" ? v.error.message.replace(/\s+/g, " ").slice(0, 320) : "",
    ).catch(() => "");
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
      res.status === 429
        ? `Google no tuvo capacidad disponible después de ${max429Attempts} intentos automáticos con el mismo modelo. ${detail}`.trim()
        : `Google respondió ${res.status}. ${detail || (code === "AMBIGUOUS" ? "Reconciliar antes de repetir." : "Revisa acceso, cuota o parámetros del modelo.")}`,
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
