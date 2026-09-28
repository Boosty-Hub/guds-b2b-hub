import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bell,
  Boxes,
  ChevronRight,
  CreditCard,
  FileText,
  Heart,
  HelpCircle,
  Landmark,
  LineChart,
  LogOut,
  MapPin,
  MessageCircle,
  Phone,
  Receipt,
  Settings,
  Shield,
  TicketPercent,
  User,
  type LucideIcon,
} from "lucide-react";
import { supabase, type Cliente } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { Panel } from "@/components/portal/sistema";
import { condicionPagoTexto, useEjecutivo } from "@/hooks/useFinanzasPortal";

// Mi cuenta: el usuario, la empresa (razón social, RIF, código, condición de pago y crédito con la misma función que el
// checkout), el ejecutivo de cuenta (función mi_ejecutivo: solo nombre, teléfono y WhatsApp) y los accesos a datos,
// finanzas y ayuda.

const SECCIONES: { titulo: string; items: { icono: LucideIcon; etiqueta: string; ruta: string; detalle?: string }[] }[] = [
  {
    titulo: "Mi cuenta",
    items: [
      { icono: User, etiqueta: "Datos personales", ruta: "/portal/cuenta/perfil" },
      { icono: MapPin, etiqueta: "Direcciones de entrega", ruta: "/portal/cuenta/direcciones" },
      { icono: Shield, etiqueta: "Seguridad", ruta: "/portal/cuenta/seguridad" },
    ],
  },
  {
    titulo: "Finanzas",
    items: [
      { icono: LineChart, etiqueta: "Estado de cuenta", ruta: "/portal/finanzas" },
      { icono: FileText, etiqueta: "Facturas", ruta: "/portal/facturas" },
      { icono: CreditCard, etiqueta: "Pagos", ruta: "/portal/pagos" },
      { icono: Landmark, etiqueta: "Cómo pagar", ruta: "/portal/cuenta/pagos" },
      { icono: Receipt, etiqueta: "Retenciones", ruta: "/portal/retenciones" },
      { icono: Boxes, etiqueta: "Consignación", ruta: "/portal/consignacion" },
    ],
  },
  {
    titulo: "Compras",
    items: [
      { icono: Heart, etiqueta: "Favoritos", ruta: "/portal/favoritos" },
      { icono: TicketPercent, etiqueta: "Cupones disponibles", ruta: "/portal/cuenta/cupones" },
    ],
  },
  {
    titulo: "Preferencias y ayuda",
    items: [
      { icono: Bell, etiqueta: "Notificaciones", ruta: "/portal/cuenta/notificaciones" },
      { icono: Settings, etiqueta: "Preferencias", ruta: "/portal/cuenta/preferencias" },
      { icono: HelpCircle, etiqueta: "Centro de ayuda", ruta: "/portal/ayuda" },
      { icono: FileText, etiqueta: "Términos y condiciones", ruta: "/terminos" },
    ],
  },
];

interface Credito { modo: string; disponible: number; limite: number }

const PortalCuenta = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [credito, setCredito] = useState<Credito | null>(null);
  const [stats, setStats] = useState({ pedidos: 0, favoritos: 0 });
  const [loading, setLoading] = useState(true);
  const ejecutivo = useEjecutivo();

  useEffect(() => {
    const cid = user?.cliente_id;
    if (!cid) { setLoading(false); return; }
    let activo = true;
    Promise.all([
      supabase.from("clientes").select("*").eq("id", cid).maybeSingle(),
      supabase.from("ordenes").select("id", { count: "exact", head: true }).eq("cliente_id", cid),
      supabase.from("favoritos").select("id", { count: "exact", head: true }).eq("usuario_id", user?.id),
      supabase.rpc("credito_disponible", { p_cliente_id: cid }),
    ]).then(([c, o, f, cr]) => {
      if (!activo) return;
      setCliente((c.data as Cliente | null) ?? null);
      setStats({ pedidos: o.count ?? 0, favoritos: f.count ?? 0 });
      setCredito(((cr.data as Credito[] | null) ?? [])[0] ?? null);
      setLoading(false);
    });
    return () => { activo = false; };
  }, [user?.cliente_id, user?.id]);

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const iniciales = user ? `${user.nombre?.charAt(0) || ""}${user.apellido?.charAt(0) || ""}`.toUpperCase() || "U" : "U";
  const limite = Number(credito?.limite ?? 0);
  const uso = limite > 0 ? Math.min(100, Math.max(0, (1 - Number(credito?.disponible ?? 0) / limite) * 100)) : 0;

  return (
    <PortalPagina titulo="Mi cuenta" descripcion="Tu empresa, tus datos y tus preferencias.">
      <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="space-y-4 lg:sticky lg:top-[5.5rem]">
          {/* Perfil */}
          <section className="rounded-xl border border-border bg-card p-5">
            {loading ? (
              <div className="flex items-center gap-4">
                <Skeleton className="h-14 w-14 rounded-full" />
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-44" /></div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <Avatar className="h-14 w-14">
                    <AvatarImage src={user?.avatar} alt="" />
                    <AvatarFallback className="bg-muted text-lg font-semibold text-foreground">{iniciales}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{[user?.nombre, user?.apellido].filter(Boolean).join(" ")}</h2>
                    <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 divide-x divide-border rounded-lg border border-border text-center">
                  <div className="py-2.5"><dt className="text-xs text-muted-foreground">Pedidos</dt><dd className="text-lg font-semibold tabular-nums">{stats.pedidos}</dd></div>
                  <div className="py-2.5"><dt className="text-xs text-muted-foreground">Favoritos</dt><dd className="text-lg font-semibold tabular-nums">{stats.favoritos}</dd></div>
                </dl>
              </>
            )}
          </section>

          {/* Empresa: razón social, RIF, código, condición de pago y crédito */}
          <Panel titulo="Tu empresa">
            {loading ? (
              <div className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-32" /><Skeleton className="h-3 w-40" /></div>
            ) : !cliente ? (
              <p className="text-sm text-muted-foreground">No encontramos la ficha de tu empresa.</p>
            ) : (
              <div data-testid="cuenta-empresa">
                <p className="font-medium leading-snug">{cliente.nombre_negocio}</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">RIF</dt><dd className="tabular-nums" data-testid="cuenta-rif">{cliente.rif || "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Código de cliente</dt><dd className="tabular-nums">{cliente.codigo || "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Condición de pago</dt><dd className="text-right">{condicionPagoTexto(cliente.condicion_pago, cliente.dias_credito) ?? "—"}</dd></div>
                  {credito && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Crédito</dt>
                      <dd className="text-right tabular-nums" data-testid="cuenta-credito">
                        {credito.modo === "abierto" ? "Abierto (sin tope)" : limite > 0 ? `${formatPrice(Number(credito.disponible))} disponible` : "Sin línea de crédito"}
                      </dd>
                    </div>
                  )}
                </dl>
                {credito && credito.modo !== "abierto" && limite > 0 && (
                  <>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-foreground/70" style={{ width: `${uso}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">{uso.toFixed(0)} % utilizado de {formatPrice(limite)}</p>
                  </>
                )}
              </div>
            )}
          </Panel>

          {/* Ejecutivo de cuenta */}
          <Panel titulo="Tu ejecutivo de cuenta">
            {ejecutivo === undefined ? (
              <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-9 w-full" /></div>
            ) : ejecutivo === null ? (
              <p className="text-sm text-muted-foreground">Aún no tienes un ejecutivo asignado. Escríbenos desde <Link to="/portal/ayuda" className="font-medium text-primary hover:underline">Ayuda</Link>.</p>
            ) : (
              <div data-testid="cuenta-ejecutivo">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-muted text-sm font-semibold text-foreground">
                      {ejecutivo.nombre.split(/\s+/).slice(0, 2).map((p) => p.charAt(0)).join("").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate font-medium" data-testid="ejecutivo-nombre">{ejecutivo.nombre}</p>
                    <p className="text-xs text-muted-foreground">{ejecutivo.telefono ? <span className="tabular-nums">{ejecutivo.telefono}</span> : "Sin teléfono registrado"}</p>
                  </div>
                </div>
                {(ejecutivo.telefono || ejecutivo.whatsapp) && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {ejecutivo.whatsapp && (
                      <a href={`https://wa.me/${ejecutivo.whatsapp}`} target="_blank" rel="noopener noreferrer" data-testid="ejecutivo-whatsapp"
                        className="flex h-10 items-center justify-center gap-2 rounded-md border border-border text-sm font-medium hover:bg-muted">
                        <MessageCircle className="h-4 w-4" />WhatsApp
                      </a>
                    )}
                    {ejecutivo.telefono && (
                      <a href={`tel:${ejecutivo.telefono.replace(/[^\d+]/g, "")}`}
                        className={cn("flex h-10 items-center justify-center gap-2 rounded-md border border-border text-sm font-medium hover:bg-muted", !ejecutivo.whatsapp && "col-span-2")}>
                        <Phone className="h-4 w-4" />Llamar
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        {/* Menú */}
        <div className="mt-6 space-y-6 lg:mt-0">
          <div className="space-y-6 md:columns-2 md:gap-6 md:space-y-0">
            {SECCIONES.map((s) => (
              <section key={s.titulo} className="md:mb-6 md:break-inside-avoid">
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.titulo}</h3>
                <ul className="overflow-hidden rounded-xl border border-border bg-card">
                  {s.items.map((it) => (
                    <li key={it.ruta} className="border-b border-border last:border-0">
                      <Link to={it.ruta} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50">
                        <it.icono className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <span className="flex-1 text-sm font-medium">{it.etiqueta}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <button type="button" onClick={cerrarSesion}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50">
            <LogOut className="h-4 w-4" />Cerrar sesión
          </button>

          {/* En B2B cerrar el acceso no es una opción del día a día: queda al fondo y discreto */}
          <p className="text-center text-xs text-muted-foreground">
            ¿Ya no usarás el portal? <Link to="/portal/cuenta/eliminar" className="underline underline-offset-2 hover:text-foreground">Cerrar mi acceso</Link>
          </p>
        </div>
      </div>
    </PortalPagina>
  );
};

export default PortalCuenta;
