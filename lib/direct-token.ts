import { createHmac, timingSafeEqual } from "node:crypto";
import { required } from "./config";
export function continuationToken(id: string, step: number, expires = Date.now() + 60000) {
  const data = `${id}:${step}:${expires}`;
  return `${expires}.${createHmac("sha256", required("SESSION_SECRET")).update(`universos-direct:${data}`).digest("hex")}`;
}
export function validContinuation(token: string, id: string, step: number) {
  const [time, signature] = token.split(".");
  const expires = Number(time);
  if (!Number.isFinite(expires) || expires < Date.now() || expires > Date.now() + 65000 || !/^[a-f0-9]{64}$/.test(signature || "")) return false;
  const expected = continuationToken(id, step, expires).split(".")[1];
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
