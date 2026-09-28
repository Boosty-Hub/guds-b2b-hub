import { AlertTriangle, CheckCircle2, Clock, FlaskConical, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ETIQUETA_CAMPO, type EscrituraCliente } from "./odooCliente";

const valor = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Lista compacta de lo que cambia en Odoo (campo: antes → después). */
export function CambiosOdoo({ escritura, className }: { escritura: EscrituraCliente; className?: string }) {
  const cambios = escritura.resultado?.cambios;
  if (escritura.accion === "crear") {
    const c = escritura.campos ?? {};
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {[c.nombre, c.calle, c.complemento, c.ciudad, c.estado, c.telefono].filter(Boolean).join(" · ")}
      </p>
    );
  }
  if (!cambios) {
    const c = escritura.campos ?? {};
    return (
      <ul className={cn("space-y-0.5 text-xs", className)}>
        {Object.entries(c).filter(([k]) => k !== "nombre").map(([k, v]) => (
          <li key={k} className="break-words"><span className="text-muted-foreground">{ETIQUETA_CAMPO[k] ?? k}:</span> {valor(v)}</li>
        ))}
      </ul>
    );
  }
  if (!cambios.length) return <p className={cn("text-xs text-muted-foreground", className)}>Sin diferencias con lo que ya tenía Odoo (se reescribieron los mismos valores).</p>;
  return (
    <ul className={cn("space-y-0.5 text-xs", className)}>
      {cambios.map((c) => (
        <li key={c.campo} className="break-words">
          <span className="text-muted-foreground">{ETIQUETA_CAMPO[c.campo] ?? c.campo}:</span>{" "}
          <span className="text-muted-foreground line-through decoration-muted-foreground/50">{valor(c.antes)}</span> → <span className="font-medium">{valor(c.despues)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Estado de un envío a Odoo: guardando, guardado, simulado, error (con reintentar) o sin respuesta todavía. */
export function EstadoEnvioOdoo({ escritura, agotado, reintentando, errorConsulta, onReintentar }: {
  escritura: EscrituraCliente | null; agotado: boolean; reintentando: boolean; errorConsulta?: string | null; onReintentar: () => void;
}) {
  const estado = escritura?.estado ?? "pendiente";
  if (agotado && (estado === "pendiente" || estado === "procesando")) {
    return (
      <div className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" role="status">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div>
          <p className="font-medium">Odoo no ha respondido todavía</p>
          <p className="text-xs text-muted-foreground">El cambio quedó en cola y se reintenta en la próxima sincronización. Puedes cerrar esta ventana y ver el resultado en "Cambios a Odoo".</p>
        </div>
      </div>
    );
  }
  if (estado === "pendiente" || estado === "procesando") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm" role="status">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <span>Guardando en Odoo…</span>
        {errorConsulta && <span className="text-xs text-destructive">({errorConsulta})</span>}
      </div>
    );
  }
  if (estado === "error") {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm" role="alert">
        <div className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Odoo no aceptó el cambio</p>
            <p className="break-words text-xs text-muted-foreground">{escritura?.error ?? "Error desconocido"}</p>
            {errorConsulta && <p className="break-words text-xs text-destructive">{errorConsulta}</p>}
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onReintentar} disabled={reintentando}>
            {reintentando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reintentar
          </Button>
        </div>
      </div>
    );
  }
  if (estado === "simulada") {
    return (
      <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" role="status">
        <div className="mb-1 flex items-center gap-2 font-medium"><FlaskConical className="h-4 w-4 text-warning" /> Simulación: Odoo no se modificó</div>
        <p className="mb-1.5 text-xs text-muted-foreground">La escritura de clientes en Odoo está en modo "simular". Esto es lo que se habría enviado:</p>
        {escritura && <CambiosOdoo escritura={escritura} />}
      </div>
    );
  }
  const r = escritura?.resultado;
  return (
    <div className="rounded-md border border-success/50 bg-success/10 p-3 text-sm" role="status">
      <div className="mb-1 flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-success" /> {escritura?.accion === "crear" ? (r?.ya_existia ? "La dirección ya existía en Odoo: quedó vinculada" : "Dirección creada en Odoo") : "Guardado en Odoo"}</div>
      {escritura && <CambiosOdoo escritura={escritura} />}
      {!!r?.no_aplicados?.length && (
        <p className="mt-1 text-xs text-warning">Odoo guardó distinto: {r.no_aplicados.map((c) => ETIQUETA_CAMPO[c] ?? c).join(", ")} (la ficha muestra lo que quedó en Odoo).</p>
      )}
      {!!r?.contactos_hijos && <p className="mt-1 text-xs text-muted-foreground">Odoo copió la dirección a {r.contactos_hijos} persona(s) de contacto del cliente.</p>}
    </div>
  );
}
