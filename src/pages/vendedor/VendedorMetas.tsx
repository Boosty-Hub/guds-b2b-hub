import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Target, 
  TrendingUp, 
  Award, 
  Calendar,
  DollarSign,
  Users,
  ShoppingCart,
  Star,
  Trophy,
  Flame
} from "lucide-react";

interface MetaMensual {
  mes: string;
  meta: number;
  logrado: number;
  estado: "completado" | "en_progreso" | "pendiente";
}

interface MetaCategoria {
  categoria: string;
  meta: number;
  actual: number;
  unidad: string;
}

const metasMensuales: MetaMensual[] = [
  { mes: "Enero 2024", meta: 150000, logrado: 98500, estado: "en_progreso" },
  { mes: "Diciembre 2023", meta: 140000, logrado: 156000, estado: "completado" },
  { mes: "Noviembre 2023", meta: 130000, logrado: 142000, estado: "completado" },
  { mes: "Octubre 2023", meta: 130000, logrado: 118000, estado: "completado" },
  { mes: "Septiembre 2023", meta: 120000, logrado: 125000, estado: "completado" },
];

const metasPorCategoria: MetaCategoria[] = [
  { categoria: "Ventas Totales", meta: 150000, actual: 98500, unidad: "$" },
  { categoria: "Nuevos Pedidos", meta: 35, actual: 28, unidad: "" },
  { categoria: "Clientes Activos", meta: 12, actual: 10, unidad: "" },
  { categoria: "Pagos Cobrados", meta: 80000, actual: 45200, unidad: "$" },
];

const logros = [
  { id: 1, nombre: "Vendedor del Mes", descripcion: "Diciembre 2023", icono: Trophy, color: "text-yellow-500", bg: "bg-yellow-500/10" },
  { id: 2, nombre: "Meta Superada x3", descripcion: "Q4 2023", icono: Star, color: "text-purple-500", bg: "bg-purple-500/10" },
  { id: 3, nombre: "Racha de 5 meses", descripcion: "Metas cumplidas", icono: Flame, color: "text-orange-500", bg: "bg-orange-500/10" },
];

const VendedorMetas = () => {
  const metaActual = metasMensuales[0];
  const porcentajeMeta = (metaActual.logrado / metaActual.meta) * 100;
  const diasRestantes = 16; // Días restantes del mes

  const getEstadoBadge = (estado: string) => {
    switch (estado) {
      case "completado":
        return <Badge className="bg-green-500/10 text-green-500">Completado</Badge>;
      case "en_progreso":
        return <Badge className="bg-blue-500/10 text-blue-500">En Progreso</Badge>;
      default:
        return <Badge variant="secondary">Pendiente</Badge>;
    }
  };

  const getProgressColor = (porcentaje: number) => {
    if (porcentaje >= 100) return "bg-green-500";
    if (porcentaje >= 70) return "bg-emerald-500";
    if (porcentaje >= 50) return "bg-amber-500";
    return "bg-red-500";
  };

  return (
    <VendedorLayout title="Mis Metas">
      {/* Meta Principal del Mes */}
      <Card className="border-border mb-6 overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 p-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-emerald-100 text-sm">Meta del Mes</p>
              <h2 className="text-3xl font-bold">{metaActual.mes}</h2>
            </div>
            <div className="h-16 w-16 rounded-full bg-white/20 flex items-center justify-center">
              <Target className="h-8 w-8" />
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-emerald-100 text-sm">Meta</p>
              <p className="text-2xl font-bold">${metaActual.meta.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-emerald-100 text-sm">Logrado</p>
              <p className="text-2xl font-bold">${metaActual.logrado.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-emerald-100 text-sm">Restante</p>
              <p className="text-2xl font-bold">${(metaActual.meta - metaActual.logrado).toLocaleString()}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{porcentajeMeta.toFixed(1)}% completado</span>
              <span>{diasRestantes} días restantes</span>
            </div>
            <div className="h-3 bg-white/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-white rounded-full transition-all duration-500"
                style={{ width: `${Math.min(porcentajeMeta, 100)}%` }}
              />
            </div>
          </div>
        </div>

        <CardContent className="p-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span className="text-muted-foreground">
                Necesitas vender <strong className="text-foreground">${((metaActual.meta - metaActual.logrado) / diasRestantes).toFixed(0)}/día</strong> para alcanzar la meta
              </span>
            </div>
            {porcentajeMeta >= 100 && (
              <Badge className="bg-green-500 text-white">
                <Trophy className="h-3 w-3 mr-1" />
                ¡Meta Alcanzada!
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        {/* Metas por Categoría */}
        <Card className="border-border lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Desglose de Metas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {metasPorCategoria.map((meta, index) => {
              const porcentaje = (meta.actual / meta.meta) * 100;
              return (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{meta.categoria}</span>
                    <span className="text-sm text-muted-foreground">
                      {meta.unidad}{meta.actual.toLocaleString()} / {meta.unidad}{meta.meta.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={porcentaje} className="flex-1 h-2" />
                    <span className={`text-sm font-medium min-w-[50px] text-right ${
                      porcentaje >= 100 ? "text-green-500" : 
                      porcentaje >= 70 ? "text-emerald-500" : 
                      porcentaje >= 50 ? "text-amber-500" : "text-red-500"
                    }`}>
                      {porcentaje.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Logros */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="h-5 w-5 text-amber-500" />
              Mis Logros
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {logros.map((logro) => (
              <div
                key={logro.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className={`h-10 w-10 rounded-full ${logro.bg} flex items-center justify-center`}>
                  <logro.icono className={`h-5 w-5 ${logro.color}`} />
                </div>
                <div>
                  <p className="font-medium text-sm">{logro.nombre}</p>
                  <p className="text-xs text-muted-foreground">{logro.descripcion}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Historial de Metas */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Historial de Metas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {metasMensuales.map((meta, index) => {
              const porcentaje = (meta.logrado / meta.meta) * 100;
              const superado = meta.logrado > meta.meta;
              
              return (
                <div
                  key={index}
                  className={`rounded-lg border p-4 ${
                    index === 0 ? "border-emerald-500/50 bg-emerald-500/5" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                        superado ? "bg-green-500/10" : 
                        porcentaje >= 90 ? "bg-emerald-500/10" : "bg-amber-500/10"
                      }`}>
                        {superado ? (
                          <Trophy className="h-5 w-5 text-green-500" />
                        ) : (
                          <Target className={`h-5 w-5 ${
                            porcentaje >= 90 ? "text-emerald-500" : "text-amber-500"
                          }`} />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{meta.mes}</p>
                        <p className="text-sm text-muted-foreground">
                          Meta: ${meta.meta.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold text-lg ${
                        superado ? "text-green-500" : "text-foreground"
                      }`}>
                        ${meta.logrado.toLocaleString()}
                      </p>
                      <div className="flex items-center gap-2">
                        {getEstadoBadge(meta.estado)}
                        {superado && (
                          <Badge className="bg-green-500/10 text-green-500">
                            +{((porcentaje - 100)).toFixed(0)}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Progress value={Math.min(porcentaje, 100)} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-2 text-right">
                    {porcentaje.toFixed(1)}% de la meta
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Proyección */}
      <Card className="border-border mt-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
            Proyección de Comisiones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-muted p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">Comisión Base (5%)</p>
              <p className="text-2xl font-bold">${(metaActual.logrado * 0.05).toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">Bono por Meta (si alcanza)</p>
              <p className="text-2xl font-bold text-emerald-500">+$3,000</p>
            </div>
            <div className="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 p-4 text-center text-white">
              <p className="text-sm text-emerald-100 mb-1">Comisión Proyectada</p>
              <p className="text-2xl font-bold">
                ${((metaActual.logrado * 0.05) + (porcentajeMeta >= 100 ? 3000 : 0)).toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </VendedorLayout>
  );
};

export default VendedorMetas;
