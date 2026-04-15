import { BarChart3, ClipboardList, FileCog, LayoutDashboard, LogOut, Settings2, Users2 } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import logo from "@/assets/hospital-logo.png";
import { useAuth } from "@/hooks/use-auth";
import { canManageSystem, canManageUsers, hasAnyRole } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Array<"admin" | "director" | "doctor" | "nurse" | "staff">;
};

const navItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/data-entry", label: "Bed Entry", icon: ClipboardList },
  { to: "/kpi-builder", label: "KPI Builder", icon: BarChart3, roles: ["admin", "director"] },
  { to: "/categories", label: "Categories", icon: Settings2, roles: ["admin"] },
  { to: "/form-builder", label: "Form Builder", icon: FileCog, roles: ["admin"] },
  { to: "/users", label: "Users", icon: Users2, roles: ["admin"] },
];

export const AppShell = () => {
  const { roles, signOut, profile } = useAuth();
  const location = useLocation();

  const canSystem = canManageSystem(roles);
  const canUsers = canManageUsers(roles);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-sidebar-primary/20 p-1">
            <img src={logo} alt="Taif Children's Hospital logo" className="h-10 w-10 object-contain" loading="lazy" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sidebar-foreground/80">Taif Children's Hospital</p>
            <h1 className="text-sm font-bold">Bed Management</h1>
          </div>
        </div>

        <nav className="space-y-1 p-3">
          {navItems
            .filter((item) => !item.roles || hasAnyRole(roles, item.roles))
            .filter((item) => (item.to !== "/kpi-builder" ? true : canSystem))
            .filter((item) => (item.to !== "/users" ? true : canUsers))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "hospital-transition flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
        </nav>

        <div className="mt-auto border-t border-sidebar-border p-4">
          <p className="text-xs text-sidebar-foreground/70">Signed in as</p>
          <p className="truncate text-sm font-semibold">{profile?.display_name ?? "Hospital User"}</p>
          <Button
            variant="secondary"
            className="mt-3 w-full bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
            onClick={() => void signOut()}
          >
            <LogOut className="mr-2 h-4 w-4" /> Logout
          </Button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Hospital logo" className="h-8 w-8 object-contain" loading="lazy" />
            <p className="text-sm font-bold">Taif Bed Management</p>
          </div>
        </header>

        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="flex-1 p-4 md:p-8"
        >
          <Outlet />
        </motion.main>
      </div>
    </div>
  );
};
