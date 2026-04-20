import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchNavVisibilitySettings,
  fetchOccupancyBenchmarkSettings,
  fetchRoleCatalog,
  saveNavVisibilitySettings,
  saveOccupancyBenchmarkSettings,
} from "@/lib/supabase-api";
import { NavVisibilitySettingsEditor } from "@/components/settings/nav-visibility-settings";
import type { NavVisibilitySettings, OccupancyBenchmarkSettings } from "@/types/hospital";

const defaultNavSettings: NavVisibilitySettings = {
  admin: { dashboard: true, data_entry: true, kpi_builder: true, categories: true, form_builder: true, users: true },
  director: { dashboard: true, data_entry: true, kpi_builder: true, categories: true, form_builder: true, users: true },
  doctor: { dashboard: true, data_entry: true, kpi_builder: true, categories: true, form_builder: true, users: true },
  nurse: { dashboard: true, data_entry: true, kpi_builder: true, categories: true, form_builder: true, users: true },
  staff: { dashboard: true, data_entry: true, kpi_builder: true, categories: true, form_builder: true, users: true },
};

const defaultOccupancyBenchmarkSettings: OccupancyBenchmarkSettings = {
  levels: [
    { key: "safe", label: "Safe", maxPercent: 70, color: "#16a34a" },
    { key: "watch", label: "Watch", maxPercent: 85, color: "#f59e0b" },
    { key: "critical", label: "Critical", maxPercent: 100, color: "#dc2626" },
  ],
};

const SettingsPage = () => {
  const { roles, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: serverSettings } = useQuery({
    queryKey: ["app_settings", "nav_visibility"],
    queryFn: fetchNavVisibilitySettings,
  });
  const { data: roleCatalog = ["admin", "director", "doctor", "nurse", "staff"] } = useQuery({
    queryKey: ["app_settings", "role_catalog"],
    queryFn: fetchRoleCatalog,
  });
  const { data: occupancyServerSettings } = useQuery({
    queryKey: ["app_settings", "occupancy_benchmark"],
    queryFn: fetchOccupancyBenchmarkSettings,
  });

  const [draft, setDraft] = useState<NavVisibilitySettings>(defaultNavSettings);
  const [occupancyDraft, setOccupancyDraft] = useState<OccupancyBenchmarkSettings>(defaultOccupancyBenchmarkSettings);

  const current = serverSettings ?? draft;
  const currentOccupancy = occupancyServerSettings ?? occupancyDraft;

  const saveMutation = useMutation({
    mutationFn: (next: NavVisibilitySettings) => {
      if (!user?.id) throw new Error("You must be signed in to save settings.");
      return saveNavVisibilitySettings(roles, next, user.id);
    },
    onSuccess: async () => {
      toast({ title: "Settings saved" });
      await queryClient.invalidateQueries({ queryKey: ["app_settings", "nav_visibility"] });
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  const saveOccupancyMutation = useMutation({
    mutationFn: (next: OccupancyBenchmarkSettings) => {
      if (!user?.id) throw new Error("You must be signed in to save settings.");
      return saveOccupancyBenchmarkSettings(roles, next, user.id);
    },
    onSuccess: async () => {
      toast({ title: "Occupancy benchmark saved" });
      await queryClient.invalidateQueries({ queryKey: ["app_settings", "occupancy_benchmark"] });
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  return (
    <section className="space-y-5 sm:space-y-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure global sidebar visibility for the app menus.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Navigation Visibility</CardTitle>
          <CardDescription>Choose which sidebar menus are visible for each role.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto">
          <NavVisibilitySettingsEditor
            settings={current}
            roles={roleCatalog}
            onChange={(next) => {
              setDraft(next);
              if (serverSettings) {
                queryClient.setQueryData(["app_settings", "nav_visibility"], next);
              }
            }}
            disabled={saveMutation.isPending}
          />
          <Button onClick={() => saveMutation.mutate(current)} disabled={saveMutation.isPending}>
            Save Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Occupancy Rate Benchmark</CardTitle>
          <CardDescription>Define global occupancy percentage thresholds and color codes for all dashboard displays.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Max %</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Color</th>
                </tr>
              </thead>
              <tbody>
                {currentOccupancy.levels.map((level, index) => (
                  <tr key={level.key} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <Input
                        value={level.label}
                        onChange={(event) => {
                          const next = currentOccupancy.levels.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, label: event.target.value } : entry,
                          );
                          const payload = { levels: next };
                          setOccupancyDraft(payload);
                          if (occupancyServerSettings) queryClient.setQueryData(["app_settings", "occupancy_benchmark"], payload);
                        }}
                        disabled={saveOccupancyMutation.isPending}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={level.maxPercent}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          const next = currentOccupancy.levels.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, maxPercent: Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : entry.maxPercent }
                              : entry,
                          );
                          const payload = { levels: next };
                          setOccupancyDraft(payload);
                          if (occupancyServerSettings) queryClient.setQueryData(["app_settings", "occupancy_benchmark"], payload);
                        }}
                        disabled={saveOccupancyMutation.isPending}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={level.color}
                          onChange={(event) => {
                            const next = currentOccupancy.levels.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, color: event.target.value } : entry,
                            );
                            const payload = { levels: next };
                            setOccupancyDraft(payload);
                            if (occupancyServerSettings) queryClient.setQueryData(["app_settings", "occupancy_benchmark"], payload);
                          }}
                          disabled={saveOccupancyMutation.isPending}
                          className="h-10 w-14 cursor-pointer rounded border border-border bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`${level.label} color code`}
                        />
                        <Input
                          value={level.color}
                          onChange={(event) => {
                            const next = currentOccupancy.levels.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, color: event.target.value } : entry,
                            );
                            const payload = { levels: next };
                            setOccupancyDraft(payload);
                            if (occupancyServerSettings) queryClient.setQueryData(["app_settings", "occupancy_benchmark"], payload);
                          }}
                          disabled={saveOccupancyMutation.isPending}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={() => saveOccupancyMutation.mutate(currentOccupancy)} disabled={saveOccupancyMutation.isPending}>
            Save Occupancy Benchmark
          </Button>
        </CardContent>
      </Card>
    </section>
  );
};

export default SettingsPage;