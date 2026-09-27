import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { required } from "./config";
import { AppError } from "./errors";
import { db } from "./persistence/google";
const COOKIE = "__Host-universos";
function secret() {
  const s = required("SESSION_SECRET");
  if (s.length < 32)
    throw new AppError(
      "CONFIG",
      "SESSION_SECRET debe tener al menos 32 caracteres",
      503,
    );
  return s;
}
export function verifyPassword(password: string, encoded: string) {
  const [type, salt, hex] = encoded.split(":");
  if (type !== "scrypt" || !salt || !hex || !/^[a-f0-9]{128}$/.test(hex))
    throw new AppError("CONFIG", "APP_PASSWORD_HASH inválido", 503);
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}
export function createSession(now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: "personal",
      exp: now + 12 * 3600000,
      nonce: randomBytes(24).toString("hex"),
    }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", secret()).update(payload).digest("base64url")
  );
}
export function validSession(token: string, now = Date.now()) {
  try {
    const [payload, sig, ...rest] = token.split(".");
    if (rest.length || !payload || !sig) return false;
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const provided = Buffer.from(sig, "base64url");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    )
      return false;
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    return p.sub === "personal" && Number.isFinite(p.exp) && p.exp > now;
  } catch {
    return false;
  }
}
export function requireSession(req: Request) {
  const token =
    req.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1) || "";
  if (!validSession(token))
    throw new AppError("AUTH", "Introduce tu clave para continuar.", 401);
}
export function originCheck(req: Request) {
  const expected = new URL(required("APP_ORIGIN")).origin;
  if (req.headers.get("origin") !== expected)
    throw new AppError("CSRF", "Origen no autorizado.", 403);
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    throw new AppError("CSRF", "Solicitud no autorizada.", 403);
}
export function sessionCookie(token: string, maxAge = 43200) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export async function login(password: string) {
  const ref = db().doc("system/login");
  await db().runTransaction(async (tx) => {
    const now = Date.now(),
      s = (await tx.get(ref)).data();
    if (s && s.until > now && s.count >= 8)
      throw new AppError(
        "RATE_LIMIT",
        "Demasiados intentos. Espera 15 minutos.",
        429,
      );
    tx.set(ref, {
      count: s && s.until > now ? s.count + 1 : 1,
      until: s && s.until > now ? s.until : now + 15 * 60000,
    });
  });
  if (!verifyPassword(password, required("APP_PASSWORD_HASH")))
    throw new AppError("AUTH", "Clave incorrecta.", 401);
  return createSession();
}
