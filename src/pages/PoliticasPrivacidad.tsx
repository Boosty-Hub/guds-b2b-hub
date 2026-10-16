import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";
import { CORREO_PRIVACIDAD, DESARROLLADOR, NOMBRE_APP, SITIO_PORTAL } from "@/lib/legal";

// Pública a propósito (fuera de ProtectedRoute): es la URL de la política de privacidad en Google Play y App Store, así
// que abre sin sesión y sin la app instalada. Google Play la compara con el formulario de Seguridad de los datos: todo lo
// que se diga aquí tiene que coincidir con lo que la app recopila de verdad y con quién lo recibe. Si se agrega un dato o
// un proveedor nuevo, se actualiza esta página (y la fecha) y el formulario de Play.

const ULTIMA_ACTUALIZACION = "16 de octubre de 2026";

const Seccion = ({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) => (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-foreground">{numero}. {titulo}</h2>
    {children}
  </section>
);

const Parrafo = ({ children }: { children: ReactNode }) => (
  <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
);

const Lista = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">{children}</ul>
);

const Dato = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>;

const Correo = () => (
  <a href={`mailto:${CORREO_PRIVACIDAD}`} className="font-medium text-primary hover:underline break-all">
    {CORREO_PRIVACIDAD}
  </a>
);

const PoliticasPrivacidad = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
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

        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold text-foreground">Política de privacidad</h1>
          <p className="text-sm text-muted-foreground">Última actualización: {ULTIMA_ACTUALIZACION}</p>
        </header>

        <Seccion numero={1} titulo="Quiénes somos">
          <Parrafo>
            {DESARROLLADOR} ("GUDS", "nosotros") es una distribuidora mayorista. Esta política explica qué información
            personal recopilamos, para qué la usamos, con quién la compartimos y qué opciones tienes. Aplica a la app{" "}
            {NOMBRE_APP} para iPhone y Android y al portal web {SITIO_PORTAL}, que son el mismo servicio.
          </Parrafo>
          <Parrafo>
            {NOMBRE_APP} es un servicio entre empresas: lo usan nuestros clientes (comercios), nuestros vendedores y
            repartidores, y nuestro personal administrativo. Las cuentas de clientes se abren con una solicitud de registro que
            revisamos o las crea GUDS para tu empresa; las de vendedores y repartidores las crea GUDS.
          </Parrafo>
        </Seccion>

        <Seccion numero={2} titulo="Información que recopilamos">
          <Lista>
            <li>
              <Dato>Solicitud de registro como cliente:</Dato> razón social, RIF, tipo de negocio, si es contribuyente especial,
              el documento del RIF que subes, nombre, correo y teléfono de la persona de contacto, dirección fiscal y de
              entrega, ciudad y estado.
            </li>
            <li>
              <Dato>Tu cuenta:</Dato> nombre, apellido, correo, teléfono, rol y, si decides subirla, una foto de perfil. Tu
              contraseña la guarda el servicio de autenticación solo de forma protegida (con hash); nadie puede leerla.
            </li>
            <li>
              <Dato>Pedidos, pagos y cuenta comercial:</Dato> pedidos, facturas, notas de entrega, estado de cuenta y crédito;
              los pagos que reportas (referencia, banco, monto, fecha) con la imagen del comprobante; y los comprobantes de
              retención de impuestos que subes.
            </li>
            <li>
              <Dato>Vendedores:</Dato> los pedidos y cobros que registran para sus clientes, con la foto del comprobante de pago.
            </li>
            <li>
              <Dato>Repartidores:</Dato> fotos de evidencia de entrega, la firma y el nombre de quien recibe y las notas de la
              entrega. También la <Dato>ubicación precisa</Dato> del teléfono, solo con la app abierta y en primer plano:
              mientras el repartidor tiene una ruta activa o una entrega en camino (una lectura cada pocos minutos, que se
              borra a los 90 días) y al confirmar una entrega (se guarda con esa entrega). La app no usa la ubicación en
              segundo plano ni la de clientes o vendedores.
            </li>
            <li>
              <Dato>Notificaciones:</Dato> si las permites, un identificador (token) por teléfono que Apple o Google usan para
              entregarlas, junto con la plataforma, la versión de la app y el modelo del teléfono.
            </li>
            <li>
              <Dato>Soporte:</Dato> si usas el chat de soporte con la sesión iniciada, tu nombre, tu correo y lo que escribas.
            </li>
          </Lista>
          <Parrafo>
            <Dato>Lo que no hacemos.</Dato> Los pagos no se procesan en la app: los clientes reportan transferencias, pagos
            móviles o Zelle hechos fuera de ella, y no pedimos ni guardamos datos de tarjetas. La app no muestra publicidad, no
            usa el identificador de publicidad del teléfono, no tiene herramientas de analítica ni cookies de seguimiento, y no
            vendemos tus datos. No accede a tus contactos ni a tu calendario. Usa la cámara solo cuando decides tomar una foto,
            y las imágenes que adjuntas las eliges tú en el selector del sistema. En tu teléfono o navegador guardamos tu
            sesión y algunas preferencias para que la app funcione.
          </Parrafo>
        </Seccion>

        <Seccion numero={3} titulo="Para qué la usamos">
          <Lista>
            <li>Revisar tu solicitud de registro y abrir y administrar tu cuenta de cliente.</li>
            <li>Tomar, preparar, facturar y entregar tus pedidos, y llevar tu estado de cuenta, tus pagos y tu crédito.</li>
            <li>Organizar las rutas de reparto, saber cuándo y dónde se entregó un pedido y resolver reclamos sobre una entrega.</li>
            <li>Avisarte por notificación o correo sobre tus pedidos, pagos y cuenta, y enviarte tu estado de cuenta.</li>
            <li>Conciliar los pagos reportados con los movimientos de nuestras cuentas bancarias.</li>
            <li>Darte soporte, mantener el servicio seguro y evitar usos indebidos.</li>
            <li>Cumplir nuestras obligaciones legales, contables y fiscales.</li>
          </Lista>
        </Seccion>

        <Seccion numero={4} titulo="Con quién la compartimos">
          <Parrafo>No vendemos ni alquilamos tu información. Solo la compartimos con:</Parrafo>
          <Lista>
            <li>
              <Dato>Nuestro personal,</Dato> según su función: el vendedor asignado a tu cuenta, el repartidor que lleva tu
              pedido (nombre del negocio, dirección y contacto de entrega) y el personal administrativo.
            </li>
            <li>
              <Dato>Proveedores que operan partes del servicio</Dato> por cuenta nuestra y solo para ese fin:
              <ul className="mt-2 list-[circle] space-y-1.5 pl-5">
                <li>Supabase: alojamiento, inicio de sesión, base de datos y almacenamiento de archivos.</li>
                <li>Google Firebase Cloud Messaging y Apple Push Notification service: notificaciones a los teléfonos.</li>
                <li>Boosty Support: el chat de soporte, que recibe el nombre y el correo de quien tiene la sesión iniciada.</li>
                <li>Mapbox: mapas y búsqueda de direcciones en las pantallas de nuestro personal (rutas y ubicaciones de entrega).</li>
                <li>Resend: envío por correo de los estados de cuenta.</li>
                <li>
                  Anthropic: asistencia con inteligencia artificial en la conciliación bancaria interna; procesa líneas de
                  nuestros extractos bancarios y las referencias de los pagos reportados.
                </li>
                <li>Odoo: nuestro sistema administrativo (ERP), donde se registran clientes, pedidos, facturas y pagos.</li>
              </ul>
            </li>
            <li>
              <Dato>Autoridades,</Dato> cuando la ley lo exija o para proteger los derechos y la seguridad de GUDS, de nuestros
              clientes o de terceros.
            </li>
          </Lista>
          <Parrafo>Algunos de estos proveedores procesan los datos en servidores fuera de Venezuela.</Parrafo>
        </Seccion>

        <Seccion numero={5} titulo="Seguridad">
          <Parrafo>
            La información viaja cifrada entre tu teléfono o navegador y nuestros servidores (HTTPS). El acceso a los datos
            está limitado según el rol de cada usuario: un cliente ve los datos de su propia empresa y nuestro personal, lo que
            necesita para su trabajo. Ningún sistema es infalible; si ocurre un incidente que afecte tus datos personales, te
            avisaremos según lo exija la ley.
          </Parrafo>
        </Seccion>

        <Seccion numero={6} titulo="Cuánto tiempo la conservamos">
          <Lista>
            <li>Los datos de tu cuenta, mientras la cuenta exista.</li>
            <li>
              Los pedidos, facturas, notas de entrega, pagos, retenciones y la ficha de cliente de tu empresa, por el plazo que
              exigen nuestras obligaciones legales, contables y fiscales, aunque elimines tu cuenta.
            </li>
            <li>Las lecturas de ubicación de los repartidores durante una ruta, 90 días.</li>
            <li>
              Los tokens de notificación, hasta que cierras sesión, eliminas tu cuenta o Apple o Google informan que ya no son
              válidos.
            </li>
          </Lista>
        </Seccion>

        <Seccion numero={7} titulo="Eliminar tu cuenta">
          <Parrafo>
            Puedes eliminar tu cuenta desde la app (Mi cuenta → Cerrar mi acceso → Eliminar mi cuenta) o por correo, sin
            necesidad de la app. Se eliminan tu acceso, tus sesiones, los teléfonos registrados para notificaciones, tu carrito
            y tus favoritos; los registros comerciales y fiscales se conservan como se explica arriba. Los pasos y el detalle
            están en{" "}
            <Link to="/eliminar-cuenta" className="font-medium text-primary hover:underline">{SITIO_PORTAL}/eliminar-cuenta</Link>.
            Las cuentas de vendedores y repartidores se eliminan a solicitud, escribiendo a la empresa.
          </Parrafo>
        </Seccion>

        <Seccion numero={8} titulo="Tus derechos y opciones">
          <Lista>
            <li>
              Si eres cliente, puedes ver y corregir tus datos personales en Mi cuenta → Datos personales. En cualquier caso,
              puedes pedirnos que lo hagamos.
            </li>
            <li>Puedes pedirnos una copia de tus datos personales o que eliminemos los que no estemos obligados a conservar.</li>
            <li>
              Puedes desactivar las notificaciones y retirar el permiso de cámara o de ubicación cuando quieras, desde los
              ajustes de tu teléfono.
            </li>
            <li>Para ejercer cualquiera de estos derechos, escríbenos a <Correo />.</li>
          </Lista>
        </Seccion>

        <Seccion numero={9} titulo="Menores de edad">
          <Parrafo>
            {NOMBRE_APP} es un servicio para empresas y no está dirigido a menores de 18 años. No recopilamos a sabiendas
            información de menores de edad.
          </Parrafo>
        </Seccion>

        <Seccion numero={10} titulo="Cambios a esta política">
          <Parrafo>
            Si cambiamos esta política, publicaremos la nueva versión en esta página con su fecha de actualización. Si el
            cambio es importante, también te avisaremos en la app o por correo.
          </Parrafo>
        </Seccion>

        <Seccion numero={11} titulo="Contacto">
          <Parrafo>
            {DESARROLLADOR}
            <br />
            Correo: <Correo />
            <br />
            Portal: {SITIO_PORTAL}
          </Parrafo>
        </Seccion>

        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
          <Link to="/login" className="font-medium text-primary hover:underline">Iniciar sesión</Link>
          <Link to="/eliminar-cuenta" className="font-medium text-primary hover:underline">Eliminar tu cuenta</Link>
          <Link to="/terminos" className="font-medium text-primary hover:underline">Términos y condiciones</Link>
        </div>
      </div>
    </div>
  );
};

export default PoliticasPrivacidad;
