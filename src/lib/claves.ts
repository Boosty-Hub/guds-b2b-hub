import type { AuthError } from "@supabase/supabase-js";

/** La sesión ya no vale (p. ej. un admin cambió la contraseña y cerró las sesiones): hay que volver a entrar. */
export const sesionCerrada = (e: AuthError) =>
  e.code === "session_not_found" || e.code === "refresh_token_not_found" || e.status === 401 || /session/i.test(e.message);

/** Mensajes de supabase.auth.updateUser en español. */
export function traducirErrorClave(e: AuthError): string {
  if (e.code === "same_password" || /different from the old/i.test(e.message)) return "La contraseña nueva debe ser distinta de la actual.";
  if (e.code === "weak_password" || /at least/i.test(e.message)) return "La contraseña es muy débil: usa al menos 8 caracteres con letras y números.";
  if (sesionCerrada(e)) return "Tu sesión se cerró (cambiaron tu contraseña). Entra de nuevo con la contraseña nueva.";
  if (e.status === 429) return "Demasiados intentos. Espera un momento y vuelve a intentar.";
  return e.message;
}
