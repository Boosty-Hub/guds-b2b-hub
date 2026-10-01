// Una llamada RPC con un reintento si el error es pasajero (tiempo de espera de la base, red o 5xx). Los errores de
// permiso, validación o enlace inválido (42501, P0001, 22023…) no se reintentan.

type Respuesta<T> = { data: T | null; error: { code?: string; message: string } | null };

const pasajero = (e: { code?: string; message: string }) =>
  e.code === "57014" || !e.code || /timeout|tiempo de espera|failed to fetch|network|50[0234]/i.test(e.message);

export async function rpcConReintento<T>(llamar: () => PromiseLike<Respuesta<T>>, espera = 1200): Promise<Respuesta<T>> {
  const r = await llamar();
  if (!r.error || !pasajero(r.error)) return r;
  await new Promise((ok) => setTimeout(ok, espera));
  return llamar();
}
