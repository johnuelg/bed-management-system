import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { AppShell } from "@/components/layout/app-shell";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { RoleGuard } from "@/components/auth/role-guard";
import LoginPage from "./pages/Login";
import ResetPasswordPage from "./pages/ResetPassword";
import DashboardPage from "./pages/Dashboard";
import DataEntryPage from "./pages/DataEntry";
import CategoriesPage from "./pages/Categories";
import FormBuilderPage from "./pages/FormBuilder";
import KpiBuilderPage from "./pages/KpiBuilder";
import UsersPage from "./pages/Users";
import SettingsPage from "./pages/Settings";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/data-entry" element={<DataEntryPage />} />

                <Route element={<RoleGuard allow={["admin"]} />}>
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/categories" element={<CategoriesPage />} />
                  <Route path="/form-builder" element={<FormBuilderPage />} />
                </Route>

                <Route element={<RoleGuard allow={["admin", "director"]} />}>
                  <Route path="/kpi-builder" element={<KpiBuilderPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
