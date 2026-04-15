import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { fetchNavVisibilitySettings, saveNavVisibilitySettings } from "@/lib/supabase-api";
import { NavVisibilitySettingsEditor } from "@/components/settings/nav-visibility-settings";
import type { NavVisibilitySettings } from "@/types/hospital";

const defaultNavSettings: NavVisibilitySettings = {
  doctor: { dashboard: true, data_entry: true, kpi_builder: true },
  nurse: { dashboard: true, data_entry: true, kpi_builder: true },
  staff: { dashboard: true, data_entry: true, kpi_builder: true },
};

const SettingsPage = () => {
  const { roles, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: serverSettings } = useQuery({
    queryKey: ["app_settings", "nav_visibility"],
    queryFn: fetchNavVisibilitySettings,
  });

  const [draft, setDraft] = useState<NavVisibilitySettings>(defaultNavSettings);

  const current = serverSettings ?? draft;

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

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure global sidebar visibility for the app menus.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Navigation Visibility</CardTitle>
          <CardDescription>Choose which menus are visible for users in the sidebar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <NavVisibilitySettingsEditor
            settings={current}
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
    </section>
  );
};

export default SettingsPage;