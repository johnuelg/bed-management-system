import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { fetchOccupancyBenchmarkSettings, saveOccupancyBenchmarkSettings } from "@/lib/supabase-api";
import type { OccupancyBenchmarkSettings } from "@/types/hospital";

const defaultOccupancyBenchmarkSettings: OccupancyBenchmarkSettings = {
  levels: [
    { key: "safe", label: "Safe", maxPercent: 70, color: "#16a34a" },
    { key: "watch", label: "Watch", maxPercent: 85, color: "#f59e0b" },
    { key: "critical", label: "Critical", maxPercent: 100, color: "#dc2626" },
  ],
};

export const KpiBenchmarkEditor = () => {
  const { roles, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: occupancyServerSettings } = useQuery({
    queryKey: ["app_settings", "occupancy_benchmark"],
    queryFn: fetchOccupancyBenchmarkSettings,
  });

  const [occupancyDraft, setOccupancyDraft] = useState<OccupancyBenchmarkSettings>(defaultOccupancyBenchmarkSettings);
  const currentOccupancy = occupancyServerSettings ?? occupancyDraft;

  const updateLevel = (index: number, updater: (level: OccupancyBenchmarkSettings["levels"][number]) => OccupancyBenchmarkSettings["levels"][number]) => {
    const next = currentOccupancy.levels.map((entry, entryIndex) => (entryIndex === index ? updater(entry) : entry));
    const payload = { levels: next };
    setOccupancyDraft(payload);
    if (occupancyServerSettings) queryClient.setQueryData(["app_settings", "occupancy_benchmark"], payload);
  };

  const saveOccupancyMutation = useMutation({
    mutationFn: (next: OccupancyBenchmarkSettings) => {
      if (!user?.id) throw new Error("You must be signed in to save settings.");
      return saveOccupancyBenchmarkSettings(roles, next, user.id);
    },
    onSuccess: async () => {
      toast({ title: "KPI benchmark saved" });
      await queryClient.invalidateQueries({ queryKey: ["app_settings", "occupancy_benchmark"] });
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>KPI Benchmark</CardTitle>
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
                      onChange={(event) => updateLevel(index, (entry) => ({ ...entry, label: event.target.value }))}
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
                        updateLevel(index, (entry) => ({
                          ...entry,
                          maxPercent: Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : entry.maxPercent,
                        }));
                      }}
                      disabled={saveOccupancyMutation.isPending}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={level.color}
                        onChange={(event) => updateLevel(index, (entry) => ({ ...entry, color: event.target.value }))}
                        disabled={saveOccupancyMutation.isPending}
                        className="h-10 w-14 cursor-pointer rounded border border-border bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`${level.label} color code`}
                      />
                      <Input
                        value={level.color}
                        onChange={(event) => updateLevel(index, (entry) => ({ ...entry, color: event.target.value }))}
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
          Save KPI Benchmark
        </Button>
      </CardContent>
    </Card>
  );
};