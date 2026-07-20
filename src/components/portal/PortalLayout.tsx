import { ReactNode } from "react";
import { PortalSidebar } from "./PortalSidebar";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencySwitch } from "@/components/CurrencySwitch";
import { TasaBcv } from "@/components/TasaBcv";
import { NotificationsDropdown } from "@/components/portal/NotificationsDropdown";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface PortalLayoutProps {
  children: ReactNode;
  title: string;
}

export const PortalLayout = ({ children, title }: PortalLayoutProps) => {
  const { user } = useAuth();

  const getInitials = () => {
    if (!user) return "U";
    const first = user.nombre?.charAt(0) || "";
    const last = user.apellido?.charAt(0) || "";
    return (first + last).toUpperCase() || "U";
  };

  return (
    <div className="min-h-screen bg-background">
      <PortalSidebar />
      <div className="pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-6">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <div className="flex items-center gap-4">
            <TasaBcv showButton={false} />
            <CurrencySwitch />
            <NotificationsDropdown />
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarImage src={user?.avatar} alt={user?.nombre || "Usuario"} />
                <AvatarFallback className="bg-primary/20 text-primary font-semibold">
                  {getInitials()}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block">
                <p className="text-sm font-medium">{user?.nombre} {user?.apellido}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role || "Cliente"}</p>
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
