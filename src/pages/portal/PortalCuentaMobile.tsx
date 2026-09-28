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
  LogOut,
  MapPin,
  Receipt,
  Settings,
  Shield,
  TicketPercent,
  User,
  type LucideIcon,
} from "lucide-react";
import { supabase, type Cliente } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { Panel } from "@/components/portal/sistema";

// Mi cuenta: la empresa y el usuario, el crédito (misma función que el checkout) y los accesos a datos, finanzas y ayuda.

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
    titulo: "Compras",
    items: [
      { icono: Heart, etiqueta: "Favoritos", ruta: "/portal/favoritos" },
      { icono: TicketPercent, etiqueta: "Cupones disponibles", ruta: "/portal/cuenta/cupones" },
      { icono: Boxes, etiqueta: "Consignación", ruta: "/portal/consignacion" },
    ],
  },
  {
    titulo: "Finanzas",
    items: [
      { icono: Landmark, etiqueta: "Cuentas para pagar", ruta: "/portal/cuenta/pagos" },
      { icono: CreditCard, etiqueta: "Pagos y facturas", ruta: "/portal/pagos" },
      { icono: Receipt, etiqueta: "Retenciones", ruta: "/portal/retenciones" },
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
                {cliente && (
                  <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Empresa</p>
                    <p className="mt-0.5 text-sm font-medium leading-snug">{cliente.nombre_negocio}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{[cliente.rif, cliente.codigo].filter(Boolean).join(" · ")}</p>
                  </div>
                )}
                <dl className="mt-4 grid grid-cols-2 divide-x divide-border rounded-lg border border-border text-center">
                  <div className="py-2.5"><dt className="text-xs text-muted-foreground">Pedidos</dt><dd className="text-lg font-semibold tabular-nums">{stats.pedidos}</dd></div>
                  <div className="py-2.5"><dt className="text-xs text-muted-foreground">Favoritos</dt><dd className="text-lg font-semibold tabular-nums">{stats.favoritos}</dd></div>
                </dl>
              </>
            )}
          </section>

          {/* Crédito */}
          {credito && (credito.modo === "abierto" || limite > 0) && (
            <Panel titulo="Línea de crédito">
              {credito.modo === "abierto" ? (
                <p className="text-sm text-muted-foreground">Tienes crédito abierto (sin tope).</p>
              ) : (
                <>
                  <p className="text-2xl font-semibold tabular-nums">{formatPrice(Number(credito.disponible))}</p>
                  <p className="text-xs text-muted-foreground">disponible de {formatPrice(limite)}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-foreground/70" style={{ width: `${uso}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">{uso.toFixed(0)} % utilizado</p>
                </>
              )}
            </Panel>
          )}
        </div>

        {/* Menú */}
        <div className="mt-6 space-y-6 lg:mt-0">
          <div className="grid gap-6 md:grid-cols-2">
            {SECCIONES.map((s) => (
              <section key={s.titulo}>
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
