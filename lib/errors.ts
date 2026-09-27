export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(
  ok: unknown,
  message: string,
  code = "PRECONDITION",
): asserts ok {
  if (!ok) throw new AppError(code, message, 409);
}
export function safeError(e: unknown) {
  if (e instanceof AppError) return { code: e.code, message: e.message };
  return {
    code: "INTERNAL",
    message:
      "La operación falló. Revisa la configuración o el registro del trabajo antes de reintentar.",
  };
}
