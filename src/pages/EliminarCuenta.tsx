import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Archive, ArrowLeft, Mail, Smartphone, Trash2, Users, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/Logo";
import { CORREO_PRIVACIDAD, DESARROLLADOR, NOMBRE_APP } from "@/lib/legal";

// Pública a propósito (fuera de ProtectedRoute): Google Play exige una página web donde se pueda pedir la eliminación de
// la cuenta sin tener la app instalada y sin iniciar sesión.
//
// Lo que dice esta página tiene que coincidir con lo que hace cerrar_mi_cuenta()
// (supabase/migrations/20260719_fase5b_cerrar_cuenta.sql): borra carrito y favoritos, desactiva la fila de usuarios y
// la desliga del acceso (auth_id = null), y borra auth.identities y auth.users (con eso caen en cascada las sesiones y
// los dispositivos de push de device_tokens). La ficha del cliente, los pedidos, facturas y pagos no se tocan. Si esa
// función cambia, esta página y PortalEliminarCuenta.tsx también.

const MAILTO = `mailto:${CORREO_PRIVACIDAD}?subject=${encodeURIComponent(`Solicitud de eliminación de cuenta — ${NOMBRE_APP}`)}&body=${encodeURIComponent(
  "Quiero eliminar mi cuenta de Guds Store.\n\nNombre completo:\nCorreo con el que inicio sesión:\nEmpresa y RIF (si eres cliente):\nRol (cliente, vendedor o repartidor):\n",
)}`;

const SE_ELIMINA = [
  "Tu acceso: la cuenta con la que inicias sesión (correo y contraseña) y sus identidades vinculadas. Todas tus sesiones quedan cerradas y nadie puede volver a entrar con ella.",
  "Los teléfonos registrados para recibir notificaciones push.",
  "Tu carrito de compras y tus productos favoritos.",
];

const Seccion = ({ icono: Icono, titulo, children }: { icono: LucideIcon; titulo: string; children: ReactNode }) => (
  <section className="space-y-3 rounded-xl border border-border bg-card p-5 sm:p-6">
    <div className="flex items-center gap-2">
      <Icono className="h-4 w-4 text-muted-foreground" aria-hidden />
      <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
    </div>
    {children}
  </section>
);

const Correo = () => (
  <a href={`mailto:${CORREO_PRIVACIDAD}`} className="font-medium text-primary hover:underline break-all">
    {CORREO_PRIVACIDAD}
  </a>
);

const EliminarCuenta = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/login"))}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver
        </button>

        <div className="flex justify-center">
          <Logo className="h-14 text-primary" />
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold text-foreground">Eliminar tu cuenta de {NOMBRE_APP}</h1>
          <p className="text-sm text-muted-foreground">
            {NOMBRE_APP} es la app de {DESARROLLADOR} para sus clientes, vendedores y repartidores. Puedes eliminar tu cuenta
            cuando quieras, desde la app o por correo.
          </p>
        </div>

        <Seccion icono={Smartphone} titulo="Desde la app (clientes)">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
            <li>Inicia sesión en {NOMBRE_APP}.</li>
            <li>Abre <span className="font-medium">Mi cuenta</span>.</li>
            <li>Al final de la pantalla, toca <span className="font-medium">Cerrar mi acceso</span>.</li>
            <li>Escribe ELIMINAR, toca <span className="font-medium">Eliminar mi cuenta</span> y confirma. Tu sesión se cierra en ese momento.</li>
          </ol>
          <p className="text-sm text-muted-foreground">
            La eliminación es inmediata y no se puede deshacer. Si tu empresa tiene otros usuarios, su acceso no cambia.
          </p>
        </Seccion>

        <Seccion icono={Trash2} titulo="Qué se elimina">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
            {SE_ELIMINA.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Seccion>

        <Seccion icono={Archive} titulo="Qué se conserva y por qué">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
            <li>
              Tu ficha de usuario queda <span className="font-medium">desactivada y desvinculada del acceso</span>. Conserva
              tu nombre, correo, teléfono y foto de perfil, porque los pedidos, pagos y demás registros en los que participaste
              hacen referencia a ella. Si quieres que también eliminemos esos datos de contacto, pídelo por correo: lo
              haremos salvo en lo que la ley nos obligue a conservar.
            </li>
            <li>
              La ficha de tu empresa como cliente (razón social, RIF, direcciones y documento del RIF), sus pedidos, facturas,
              notas de entrega, pagos y comprobantes reportados, retenciones y estados de cuenta. Son registros comerciales,
              contables y fiscales de {DESARROLLADOR} y se conservan por el plazo que exigen las obligaciones legales y
              fiscales aplicables. Eliminar tu acceso no elimina la cuenta comercial de tu empresa.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Más detalles en nuestra{" "}
            <Link to="/privacidad" className="font-medium text-primary hover:underline">política de privacidad</Link>.
          </p>
        </Seccion>

        <Seccion icono={Users} titulo="Vendedores y repartidores">
          <p className="text-sm text-foreground">
            Las cuentas de vendedores y repartidores las crea {DESARROLLADOR} y no se eliminan desde la app. Pide la eliminación
            a la empresa o escríbenos a <Correo />. Los pedidos, cobros y entregas en los que participaste (incluidas las fotos,
            firmas y la ubicación registradas al cerrar una entrega) se conservan como registros de la empresa. Las lecturas de
            ubicación tomadas durante una ruta se borran a los 90 días.
          </p>
        </Seccion>

        <Seccion icono={Mail} titulo="Sin la app">
          <p className="text-sm text-foreground">
            Escribe a <Correo /> desde el correo con el que inicias sesión e indica tu nombre completo y, si eres cliente, la
            empresa y su RIF. Te responderemos para confirmar cuando tu cuenta haya sido eliminada.
          </p>
          <a
            href={MAILTO}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Mail className="h-4 w-4" aria-hidden /> Pedir la eliminación por correo
          </a>
        </Seccion>

        <div className="text-center">
          <Link to="/login" className="text-sm font-medium text-primary hover:underline">Volver a iniciar sesión</Link>
        </div>
      </div>
    </div>
  );
};

export default EliminarCuenta;
