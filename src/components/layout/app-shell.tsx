import { useEffect, useState } from "react";
import { BarChart3, ChevronDown, ClipboardList, FileCog, LayoutDashboard, LogOut, Menu, Settings2, Users2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import type { ComponentType } from "react";
import logo from "@/assets/hospital-logo.png";
import { useAuth } from "@/hooks/use-auth";
import { getPrimaryRole, hasAnyRole } from "@/lib/rbac";
import { fetchNavVisibilitySettings } from "@/lib/supabase-api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { RoleMenuVisibility } from "@/types/hospital";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  settingKey: keyof RoleMenuVisibility;
  roles?: Array<"admin" | "director" | "doctor" | "nurse" | "staff">;
};

const defaultRoleVisibility: RoleMenuVisibility = {
  dashboard: false,
  data_entry: false,
  kpi_builder: false,
  categories: false,
  form_builder: false,
  users: false,
};

const topLevelNavItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, settingKey: "dashboard" },
  { to: "/data-entry", label: "Bed Entry", icon: ClipboardList, settingKey: "data_entry" },
  { to: "/users", label: "Users", icon: Users2, settingKey: "users", roles: ["admin"] },
];

const settingsSubNavItems: NavItem[] = [
  { to: "/kpi-builder", label: "KPI Builder", icon: BarChart3, settingKey: "kpi_builder", roles: ["admin", "director"] },
  { to: "/categories", label: "Categories", icon: Settings2, settingKey: "categories", roles: ["admin"] },
  { to: "/form-builder", label: "Form Builder", icon: FileCog, settingKey: "form_builder", roles: ["admin"] },
];

export const AppShell = () => {
  const { roles, signOut, profile } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpenDesktop, setSettingsOpenDesktop] = useState(false);
  const [settingsOpenMobile, setSettingsOpenMobile] = useState(false);
  const { data: navVisibility } = useQuery({ queryKey: ["app_settings", "nav_visibility"], queryFn: fetchNavVisibilitySettings });

  const primaryRole = getPrimaryRole(roles);
  const roleVisibility = primaryRole ? (navVisibility?.[primaryRole] ?? defaultRoleVisibility) : defaultRoleVisibility;
  const visibleTopLevelItems = topLevelNavItems
    .filter((item) => !item.roles || hasAnyRole(roles, item.roles))
    .filter((item) => roleVisibility[item.settingKey]);

  const visibleSettingsItems = settingsSubNavItems
    .filter((item) => !item.roles || hasAnyRole(roles, item.roles))
    .filter((item) => roleVisibility[item.settingKey]);

  const canAccessSettings = hasAnyRole(roles, ["admin"]);
  const settingsVisible = canAccessSettings && (visibleSettingsItems.length > 0 || location.pathname === "/settings");
  const settingsActive =
    location.pathname === "/settings" || visibleSettingsItems.some((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  useEffect(() => {
    if (settingsActive) {
      setSettingsOpenDesktop(true);
      setSettingsOpenMobile(true);
    }
  }, [settingsActive]);

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col lg:w-72">
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
          {visibleTopLevelItems.map((item) => (
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

          {settingsVisible ? (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setSettingsOpenDesktop((prev) => !prev)}
                className={cn(
                  "hospital-transition flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  settingsActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
                aria-expanded={settingsOpenDesktop}
                aria-controls="settings-submenu-desktop"
              >
                <Settings2 className="h-4 w-4" />
                <span className="flex-1 text-left">Settings</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", settingsOpenDesktop && "rotate-180")} />
              </button>

              {settingsOpenDesktop ? (
                <div id="settings-submenu-desktop" className="space-y-1 pl-6">
                  <NavLink
                    to="/settings"
                    className={({ isActive }) =>
                      cn(
                        "hospital-transition block rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )
                    }
                  >
                    KPI Benchmark
                  </NavLink>
                  {visibleSettingsItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          "hospital-transition block rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
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

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/95 px-3 py-3 backdrop-blur sm:px-4 md:hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <img src={logo} alt="Hospital logo" className="h-8 w-8 object-contain" loading="lazy" />
              <p className="truncate text-sm font-bold">Taif Bed Management</p>
            </div>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Open navigation menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[85vw] max-w-sm border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
                <div className="flex h-full flex-col">
                  <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-primary/20 p-1">
                      <img src={logo} alt="Taif Children's Hospital logo" className="h-8 w-8 object-contain" loading="lazy" />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-sidebar-foreground/80">Taif Children's Hospital</p>
                      <p className="text-sm font-bold">Bed Management</p>
                    </div>
                  </div>

                  <nav className="space-y-1 p-3">
                    {visibleTopLevelItems.map((item) => (
                      <NavLink
                        key={`mobile-${item.to}`}
                        to={item.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            "hospital-transition flex items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                          )
                        }
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </NavLink>
                    ))}

                    {settingsVisible ? (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => setSettingsOpenMobile((prev) => !prev)}
                          className={cn(
                            "hospital-transition flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            settingsActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                          )}
                          aria-expanded={settingsOpenMobile}
                          aria-controls="settings-submenu-mobile"
                        >
                          <Settings2 className="h-4 w-4" />
                          <span className="flex-1 text-left">Settings</span>
                          <ChevronDown className={cn("h-4 w-4 transition-transform", settingsOpenMobile && "rotate-180")} />
                        </button>

                        {settingsOpenMobile ? (
                          <div id="settings-submenu-mobile" className="space-y-1 pl-6">
                            <NavLink
                              to="/settings"
                              onClick={() => setMobileMenuOpen(false)}
                              className={({ isActive }) =>
                                cn(
                                  "hospital-transition block rounded-md px-3 py-2.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                  isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                                )
                              }
                            >
                              KPI Benchmark
                            </NavLink>
                            {visibleSettingsItems.map((item) => (
                              <NavLink
                                key={`mobile-settings-${item.to}`}
                                to={item.to}
                                onClick={() => setMobileMenuOpen(false)}
                                className={({ isActive }) =>
                                  cn(
                                    "hospital-transition block rounded-md px-3 py-2.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                    isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                                  )
                                }
                              >
                                {item.label}
                              </NavLink>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </nav>

                  <div className="mt-auto border-t border-sidebar-border p-4">
                    <p className="text-xs text-sidebar-foreground/70">Signed in as</p>
                    <p className="truncate text-sm font-semibold">{profile?.display_name ?? "Hospital User"}</p>
                    <Button
                      variant="secondary"
                      className="mt-3 w-full bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        void signOut();
                      }}
                    >
                      <LogOut className="mr-2 h-4 w-4" /> Logout
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="flex-1 p-3 sm:p-4 lg:p-8"
        >
          <Outlet />
        </motion.main>
      </div>
    </div>
  );
};
