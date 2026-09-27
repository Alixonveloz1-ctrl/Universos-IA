import { randomBytes, scryptSync } from "node:crypto";
// Run in the owner's private terminal. Values are never written to source files.
let value = "";
for await (const chunk of process.stdin) value += chunk;
const password = value.replace(/\r?\n$/, "");
if (password.length < 14) throw Error("Usa al menos 14 caracteres.");
const salt = randomBytes(32).toString("hex");
console.log(
  "APP_PASSWORD_HASH=scrypt:" +
    salt +
    ":" +
    scryptSync(password, salt, 64).toString("hex"),
);
console.log("SESSION_SECRET=" + randomBytes(48).toString("base64url"));
