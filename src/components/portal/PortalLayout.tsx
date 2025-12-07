import { ReactNode } from "react";
import { PortalSidebar } from "./PortalSidebar";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PortalLayoutProps {
  children: ReactNode;
  title: string;
}

export const PortalLayout = ({ children, title }: PortalLayoutProps) => {
  return (
    <div className="min-h-screen bg-background">
      <PortalSidebar />
      <div className="pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-6">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                3
              </span>
            </Button>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-sm font-semibold text-primary">JR</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium">Juan Rodríguez</p>
                <p className="text-xs text-muted-foreground">Comprador</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
};
