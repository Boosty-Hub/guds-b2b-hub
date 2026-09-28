import { useEffect, useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
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
import { Link, useNavigate } from "react-router-dom";
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
        a: "Desde el portal todavía no. Si necesitas cambiarlo, comunícate con tu ejecutivo de cuenta lo antes posible.",
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
  const navigate = useNavigate();
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
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1" aria-label="Volver">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Centro de Ayuda</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Buscar en ayuda..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Canales de contacto (solo datos reales) */}
        {hayCanales && (
          <div className="grid grid-cols-2 gap-3">
            {contacto.whatsapp && (
              <a href={`https://wa.me/${soloDigitos(contacto.whatsapp)}`} target="_blank" rel="noopener noreferrer">
                <div className="bg-green-600 rounded-xl p-4 text-white text-center">
                  <MessageCircle className="h-8 w-8 mx-auto mb-2" />
                  <p className="font-medium">WhatsApp</p>
                  <p className="text-xs opacity-90">{contacto.whatsapp}</p>
                </div>
              </a>
            )}
            {contacto.telefono && (
              <a href={`tel:${contacto.telefono.replace(/[^\d+]/g, "")}`}>
                <div className="bg-blue-600 rounded-xl p-4 text-white text-center">
                  <Phone className="h-8 w-8 mx-auto mb-2" />
                  <p className="font-medium">Llamar</p>
                  <p className="text-xs opacity-90">{contacto.telefono}</p>
                </div>
              </a>
            )}
            {contacto.email && (
              <a href={`mailto:${contacto.email}`} className="col-span-2">
                <Button variant="outline" className="w-full gap-2">
                  <Mail className="h-4 w-4" />
                  {contacto.email}
                </Button>
              </a>
            )}
          </div>
        )}

        {/* Ejecutivo de cuenta y datos de la empresa (vienen de Odoo) */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          {ejecutivo && (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center">
                <UserRound className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tu ejecutivo de cuenta</p>
                <p className="font-medium">{ejecutivo}</p>
              </div>
            </div>
          )}
          {empresaActiva && (
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-medium">{empresaActiva.nombre}</p>
                {empresaActiva.rif && <p className="text-sm text-muted-foreground">RIF {empresaActiva.rif}</p>}
                {empresaActiva.direccion && (
                  <p className="text-sm text-muted-foreground">
                    {empresaActiva.direccion}{empresaActiva.ciudad ? `, ${empresaActiva.ciudad}` : ""}
                  </p>
                )}
              </div>
            </div>
          )}
          {!hayCanales && (
            <p className="text-sm text-muted-foreground">
              Para dudas sobre un pedido o un pago, comunícate con tu ejecutivo de cuenta.
            </p>
          )}
        </div>

        {/* FAQ Categories */}
        <div className="space-y-3">
          <h3 className="font-semibold">Preguntas frecuentes</h3>
          {categorias.length === 0 && (
            <p className="text-sm text-muted-foreground">No encontramos preguntas con «{searchTerm}».</p>
          )}

          {categorias.map((category) => {
            const Icon = category.icon;
            const isExpanded = !!termino || expandedCategory === category.title;

            return (
              <div key={category.title} className="bg-card rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => setExpandedCategory(expandedCategory === category.title ? null : category.title)}
                  aria-expanded={isExpanded}
                  className="w-full p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <span className="font-medium">{category.title}</span>
                  </div>
                  <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`} />
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-2">
                    {category.questions.map((item) => {
                      const open = abierta === item.q || !!termino;
                      return (
                        <div key={item.q} className="rounded-lg bg-muted">
                          <button
                            onClick={() => setAbierta(abierta === item.q ? null : item.q)}
                            aria-expanded={open}
                            className="w-full text-left p-3 text-sm font-medium"
                          >
                            {item.q}
                          </button>
                          {open && <p className="px-3 pb-3 text-sm text-muted-foreground">{item.a}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-sm">
          <Link to="/terminos" className="text-primary underline-offset-2 hover:underline">Términos y condiciones</Link>
        </p>
      </div>
    </PortalMobileLayout>
  );
};

export default PortalAyuda;
