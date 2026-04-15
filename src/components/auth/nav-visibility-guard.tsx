import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { fetchNavVisibilitySettings } from "@/lib/supabase-api";
import { getPrimaryNavRole } from "@/lib/rbac";
import type { RoleMenuVisibility } from "@/types/hospital";

const defaultRoleVisibility: RoleMenuVisibility = {
  dashboard: false,
  data_entry: false,
  kpi_builder: false,
  categories: false,
  form_builder: false,
  users: false,
};

type NavVisibilityGuardProps = {
  settingKey: keyof RoleMenuVisibility;
};

export const NavVisibilityGuard = ({ settingKey }: NavVisibilityGuardProps) => {
  const { loading, roles } = useAuth();
  const { data: navVisibility, isLoading } = useQuery({
    queryKey: ["app_settings", "nav_visibility"],
    queryFn: fetchNavVisibilitySettings,
  });

  if (loading || isLoading) {
    return null;
  }

  const primaryNavRole = getPrimaryNavRole(roles);
  const canAccess =
    primaryNavRole &&
    (navVisibility?.[primaryNavRole] ?? defaultRoleVisibility)[settingKey];

  if (!canAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};