import { useEffect, useState } from "react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { BoostySupportSlot } from "@/components/support/BoostySupportSlot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  MessageCircle,
  Phone,
  Mail,
  ChevronRight,
  Package,
  CreditCard,
  ShieldQuestion,
  Building2,
  UserRound
} from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useEmpresa } from "@/contexts/EmpresaContext";

// Preguntas con respuesta real sobre cómo funciona el portal hoy (sin promesas de plazos que el negocio no ha definido).
const faqCategories = [
  {
    icon: Package,
    title: "Pedidos",
    questions: [
      {
        q: "¿Cómo hago un pedido?",
        a: "Agrega productos desde el Catálogo o tus Favoritos y envíalo desde el Carrito. El pedido queda «Pendiente de aprobación» hasta que nuestro equipo lo revise; te avisaremos por notificación cuando se apruebe o si no se puede aprobar, con el motivo.",
      },
      {
        q: "¿Dónde veo un pedido rechazado?",
        a: "En Pedidos, pestaña «Cancelados y rechazados». Ahí verás el motivo que indicó nuestro equipo.",
      },
      {
        q: "¿Puedo modificar o cancelar mi pedido?",
        a: "Mientras esté «Por aprobar» puedes editarlo: en Pedidos, abre el pedido y toca «Editar pedido» para cambiar cantidades, quitar o agregar productos y actualizar las notas. Al guardar, GUDS recalcula el total (precios vigentes, el IVA de cada producto y el envío) y el pedido sigue pendiente de aprobación. Una vez aprobado ya no se puede editar. Los pedidos que te cargó tu vendedor los modifica él. Para cancelar un pedido, comunícate con tu ejecutivo de cuenta.",
      },
    ]
  },
  {
    icon: CreditCard,
    title: "Pagos",
    questions: [
      {
        q: "¿A qué cuentas puedo pagar?",
        a: "Solo a las cuentas oficiales que aparecen en Cuenta → Cuentas para pagar. Cada cuenta muestra banco, número, titular y RIF, con botón para copiar.",
      },
      {
        q: "¿Cómo reporto un pago?",
        a: "En Pagos → Declarar un pago: elige qué estás pagando, la cuenta a la que pagaste, el monto, la referencia y adjunta el comprobante. El pago queda por verificar hasta que lo confirmemos.",
      },
      {
        q: "¿Qué significa «Por pagar»?",
        a: "Es el saldo pendiente de tus facturas emitidas. Los pagos que declaras se descuentan cuando los verificamos.",
      },
    ]
  },
  {
    icon: ShieldQuestion,
    title: "Cuenta",
    questions: [
      { q: "¿Cómo cambio mi contraseña?", a: "En Cuenta → Seguridad." },
      { q: "¿Cómo actualizo mis datos?", a: "En Cuenta → Datos personales." },
    ]
  },
];

// Canales de contacto: solo se muestran si hay un dato real. Claves opcionales en `configuracion`
// (soporte_whatsapp, soporte_telefono, soporte_email) o el teléfono/correo de la empresa sincronizado desde Odoo.
// Las claves genéricas empresa_telefono/empresa_email tienen hoy valores de ejemplo y no se usan.
interface Contacto { whatsapp: string | null; telefono: string | null; email: string | null }

const soloDigitos = (s: string) => s.replace(/[^\d]/g, "");

const PortalAyuda = () => {
  const { user } = useAuth();
  const { empresaActiva } = useEmpresa();
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [contacto, setContacto] = useState<Contacto>({ whatsapp: null, telefono: null, email: null });
  const [ejecutivo, setEjecutivo] = useState<string | null>(null);

  useEffect(() => {
    const cargar = async () => {
      const { data } = await supabase
        .from("configuracion")
        .select("clave, valor")
        .in("clave", ["soporte_whatsapp", "soporte_telefono", "soporte_email"]);
      const map = Object.fromEntries(((data as { clave: string; valor: unknown }[] | null) ?? []).map((r) => [r.clave, String(r.valor ?? "").trim()]));
      setContacto({
        whatsapp: map.soporte_whatsapp || null,
        telefono: map.soporte_telefono || empresaActiva?.telefono || null,
        email: map.soporte_email || empresaActiva?.email || null,
      });
      if (user?.cliente_id) {
        const { data: cli } = await supabase.from("clientes").select("vendedor_odoo").eq("id", user.cliente_id).maybeSingle();
        setEjecutivo((cli as { vendedor_odoo: string | null } | null)?.vendedor_odoo || null);
      }
    };
    cargar();
  }, [user?.cliente_id, empresaActiva?.telefono, empresaActiva?.email]);

  const termino = searchTerm.trim().toLowerCase();
  const categorias = faqCategories
    .map((c) => ({
      ...c,
      questions: termino ? c.questions.filter((x) => `${x.q} ${x.a}`.toLowerCase().includes(termino)) : c.questions,
    }))
    .filter((c) => c.questions.length > 0);

  const hayCanales = !!(contacto.whatsapp || contacto.telefono || contacto.email);

  return (
    <PortalPagina titulo="Centro de ayuda" descripcion="Respuestas sobre pedidos, pagos y tu cuenta, y cómo contactarnos." volver="/portal/cuenta" etiquetaVolver="Mi cuenta">
      <div className="grid gap-6 pb-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar en la ayuda"
              aria-label="Buscar en la ayuda"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 bg-card pl-9"
            />
          </div>

          <section className="space-y-3" aria-label="Preguntas frecuentes">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preguntas frecuentes</h2>
            {categorias.length === 0 && (
              <p className="text-sm text-muted-foreground">No encontramos preguntas con «{searchTerm}».</p>
            )}
            {categorias.map((category) => {
              const Icon = category.icon;
              const isExpanded = !!termino || expandedCategory === category.title || (!expandedCategory && category === categorias[0]);
              return (
                <div key={category.title} className="overflow-hidden rounded-xl border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => setExpandedCategory(isExpanded ? "__ninguna" : category.title)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center justify-between px-4 py-3.5"
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                      <span className="text-sm font-semibold">{category.title}</span>
                    </span>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </button>
                  {isExpanded && (
                    <div className="divide-y divide-border border-t border-border">
                      {category.questions.map((item) => {
                        const open = abierta === item.q || !!termino;
                        return (
                          <div key={item.q}>
                            <button
                              type="button"
                              onClick={() => setAbierta(abierta === item.q ? null : item.q)}
                              aria-expanded={open}
                              className="w-full px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
                            >
                              {item.q}
                            </button>
                            {open && <p className="px-4 pb-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-[5.5rem]">
          {/* Canales de contacto (solo datos reales) */}
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Contacto</h2>
            {ejecutivo && (
              <div className="flex items-center gap-3">
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div>
                  <p className="text-xs text-muted-foreground">Tu ejecutivo de cuenta</p>
                  <p className="text-sm font-medium">{ejecutivo}</p>
                </div>
              </div>
            )}
            {hayCanales ? (
              <div className="grid gap-2">
                {contacto.whatsapp && (
                  <Button asChild variant="outline" className="justify-start gap-2">
                    <a href={`https://wa.me/${soloDigitos(contacto.whatsapp)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp · {contacto.whatsapp}</a>
                  </Button>
                )}
                {contacto.telefono && (
                  <Button asChild variant="outline" className="justify-start gap-2">
                    <a href={`tel:${contacto.telefono.replace(/[^\d+]/g, "")}`}><Phone className="h-4 w-4" />{contacto.telefono}</a>
                  </Button>
                )}
                {contacto.email && (
                  <Button asChild variant="outline" className="justify-start gap-2">
                    <a href={`mailto:${contacto.email}`}><Mail className="h-4 w-4" /><span className="truncate">{contacto.email}</span></a>
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Para dudas sobre un pedido o un pago, comunícate con tu ejecutivo de cuenta.</p>
            )}
            {empresaActiva && (
              <div className="flex items-start gap-3 border-t border-border pt-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{empresaActiva.nombre}</p>
                  {empresaActiva.rif && <p className="text-muted-foreground">RIF {empresaActiva.rif}</p>}
                  {empresaActiva.direccion && (
                    <p className="text-muted-foreground">{empresaActiva.direccion}{empresaActiva.ciudad ? `, ${empresaActiva.ciudad}` : ""}</p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Soporte técnico del portal (widget de tickets): vive aquí y no en el encabezado */}
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">¿Algo no funciona en el portal?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Reporta un problema técnico y lo revisamos.</p>
            <BoostySupportSlot className="mt-3" />
          </section>

          <p className="text-center text-sm">
            <Link to="/terminos" className="text-primary underline-offset-2 hover:underline">Términos y condiciones</Link>
          </p>
        </aside>
      </div>
    </PortalPagina>
  );
};

export default PortalAyuda;
