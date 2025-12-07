import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, DollarSign, TrendingUp, TrendingDown, CreditCard, Eye, Receipt } from "lucide-react";

const clientAccounts = [
  { id: "CLI-001", name: "Restaurante El Buen Sabor", creditLimit: 10000, balance: -2450, lastPayment: "2024-01-10", status: "al_dia" },
  { id: "CLI-002", name: "Hotel Plaza Central", creditLimit: 25000, balance: 0, lastPayment: "2024-01-15", status: "al_dia" },
  { id: "CLI-003", name: "Cafetería Aromas", creditLimit: 5000, balance: -890, lastPayment: "2024-01-08", status: "al_dia" },
  { id: "CLI-004", name: "Supermercado Fresh", creditLimit: 50000, balance: -5200, lastPayment: "2024-01-05", status: "vencido" },
  { id: "CLI-005", name: "Panadería El Trigo", creditLimit: 8000, balance: -7800, lastPayment: "2023-12-20", status: "excedido" },
];

const transactions = [
  { id: "TRX-001", date: "2024-01-15", client: "Hotel Plaza Central", type: "pago", amount: 5890, method: "Transferencia", reference: "TRF-45678" },
  { id: "TRX-002", date: "2024-01-15", client: "Restaurante El Buen Sabor", type: "cargo", amount: 2450, method: "Orden", reference: "ORD-001" },
  { id: "TRX-003", date: "2024-01-14", client: "Cafetería Aromas", type: "pago", amount: 1500, method: "Efectivo", reference: "REC-0234" },
  { id: "TRX-004", date: "2024-01-14", client: "Supermercado Fresh", type: "cargo", amount: 12340, method: "Orden", reference: "ORD-004" },
  { id: "TRX-005", date: "2024-01-13", client: "Panadería El Trigo", type: "cargo", amount: 4560, method: "Orden", reference: "ORD-006" },
  { id: "TRX-006", date: "2024-01-12", client: "Cafetería Aromas", type: "nota_credito", amount: 250, method: "Devolución", reference: "NC-0015" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  al_dia: { label: "Al Día", variant: "default" },
  vencido: { label: "Vencido", variant: "secondary" },
  excedido: { label: "Excedido", variant: "destructive" },
};

const Cuentas = () => {
  return (
    <MainLayout title="Cuentas por Cobrar">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold text-destructive">$89,450</p>
              <p className="text-sm text-muted-foreground">Total por Cobrar</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <TrendingUp className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-success">$45,230</p>
              <p className="text-sm text-muted-foreground">Cobrado este Mes</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <DollarSign className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">$12,890</p>
              <p className="text-sm text-muted-foreground">Vencido</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">156</p>
              <p className="text-sm text-muted-foreground">Clientes con Crédito</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="accounts" className="space-y-6">
        <TabsList>
          <TabsTrigger value="accounts">Estado de Cuentas</TabsTrigger>
          <TabsTrigger value="transactions">Movimientos</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar cliente..." className="pl-9" />
            </div>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Registrar Pago
            </Button>
          </div>

          {/* Accounts Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Límite Crédito</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Disponible</TableHead>
                  <TableHead>Último Pago</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientAccounts.map((account) => {
                  const available = account.creditLimit + account.balance;
                  return (
                    <TableRow key={account.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div>
                          <p className="font-medium">{account.name}</p>
                          <p className="text-xs text-muted-foreground">{account.id}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">${account.creditLimit.toLocaleString()}</TableCell>
                      <TableCell className={`text-right font-semibold ${account.balance < 0 ? 'text-destructive' : ''}`}>
                        ${Math.abs(account.balance).toLocaleString()}
                      </TableCell>
                      <TableCell className={`text-right ${available < 0 ? 'text-destructive' : 'text-success'}`}>
                        ${available.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{account.lastPayment}</TableCell>
                      <TableCell>
                        <Badge variant={statusConfig[account.status].variant}>
                          {statusConfig[account.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Receipt className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar movimiento..." className="pl-9" />
            </div>
          </div>

          {/* Transactions Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Referencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((trx) => (
                  <TableRow key={trx.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-sm">{trx.id}</TableCell>
                    <TableCell className="text-muted-foreground">{trx.date}</TableCell>
                    <TableCell className="font-medium">{trx.client}</TableCell>
                    <TableCell>
                      <Badge variant={trx.type === "pago" ? "default" : trx.type === "cargo" ? "destructive" : "secondary"}>
                        {trx.type === "pago" ? "Pago" : trx.type === "cargo" ? "Cargo" : "Nota Crédito"}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${trx.type === "pago" || trx.type === "nota_credito" ? 'text-success' : 'text-destructive'}`}>
                      {trx.type === "pago" || trx.type === "nota_credito" ? "+" : "-"}${trx.amount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{trx.method}</TableCell>
                    <TableCell className="font-mono text-sm text-primary">{trx.reference}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Cuentas;
