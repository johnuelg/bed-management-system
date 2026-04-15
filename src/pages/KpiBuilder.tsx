import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import {
  aggregateSubmissionSums,
  deleteKpiWidget,
  evaluateFormulaFromRow,
  fetchKpiFormulas,
  fetchKpiWidgets,
  fetchTodaySubmissions,
  saveKpiFormula,
  saveKpiWidget,
} from "@/lib/supabase-api";

const defaultVariables = ["total_beds", "occupied", "closed", "vacant"];

const KpiBuilderPage = () => {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [formulaName, setFormulaName] = useState("");
  const [expression, setExpression] = useState("occupied / total_beds * 100");
  const [selectedVariables, setSelectedVariables] = useState<string[]>(["occupied", "total_beds"]);
  const [widgetName, setWidgetName] = useState("");
  const [widgetFormulaId, setWidgetFormulaId] = useState("");
  const [widgetIsVisible, setWidgetIsVisible] = useState(true);
  const [widgetToDelete, setWidgetToDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: formulas = [] } = useQuery({ queryKey: ["kpi_formulas"], queryFn: fetchKpiFormulas });
  const { data: widgets = [] } = useQuery({ queryKey: ["kpi_widgets"], queryFn: fetchKpiWidgets });
  const { data: rows = [] } = useQuery({ queryKey: ["bed_submissions_today"], queryFn: fetchTodaySubmissions });

  const sums = useMemo(() => aggregateSubmissionSums(rows), [rows]);

  const formulaValues = useMemo(() => {
    const map: Record<string, number> = {};
    for (const formula of formulas) {
      try {
        map[formula.id] = evaluateFormulaFromRow(formula.expression, {
          total_beds: sums.total_beds,
          occupied: sums.occupied,
          closed: sums.closed,
          vacant: sums.vacant,
        });
      } catch {
        map[formula.id] = Number.NaN;
      }
    }
    return map;
  }, [formulas, sums]);

  const formulaMutation = useMutation({
    mutationFn: () =>
      saveKpiFormula(roles, {
        name: formulaName,
        expression,
        variables: selectedVariables,
        is_active: true,
      }),
    onSuccess: async () => {
      toast({ title: "Formula saved" });
      setFormulaName("");
      await qc.invalidateQueries({ queryKey: ["kpi_formulas"] });
    },
    onError: (error) => toast({ title: "Formula save failed", description: (error as Error).message, variant: "destructive" }),
  });

  const widgetMutation = useMutation({
    mutationFn: () =>
      saveKpiWidget(roles, {
        name: widgetName,
        formula_id: widgetFormulaId,
        aggregation_scope: "department_sum",
          is_visible: widgetIsVisible,
        display_order: widgets.length + 1,
        refresh_seconds: 30,
      }),
    onSuccess: async () => {
      toast({ title: "Widget saved" });
      setWidgetName("");
      setWidgetFormulaId("");
      setWidgetIsVisible(true);
      await qc.invalidateQueries({ queryKey: ["kpi_widgets"] });
    },
    onError: (error) => toast({ title: "Widget save failed", description: (error as Error).message, variant: "destructive" }),
  });

  const deleteWidgetMutation = useMutation({
    mutationFn: (id: string) => deleteKpiWidget(roles, id),
    onSuccess: async () => {
      toast({ title: "Widget deleted" });
      await qc.invalidateQueries({ queryKey: ["kpi_widgets"] });
    },
    onError: (error) => toast({ title: "Widget delete failed", description: (error as Error).message, variant: "destructive" }),
  });

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">KPI Formula Builder</h1>
          <p className="text-sm text-muted-foreground">Secure mathjs evaluation with SUM-based aggregation defaults.</p>
        </div>
        <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["bed_submissions_today"] })}>
          <RefreshCcw className="mr-2 h-4 w-4" /> Manual Refresh
        </Button>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create Formula</CardTitle>
            <CardDescription>Use variable mapping and operators: + - * / ( )</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Formula Name</Label>
              <Input value={formulaName} onChange={(e) => setFormulaName(e.target.value)} placeholder="Occupancy Rate" />
            </div>
            <div className="space-y-2">
              <Label>Expression</Label>
              <Input value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="occupied / total_beds * 100" />
            </div>
            <div className="space-y-2">
              <Label>Variables</Label>
              <div className="grid grid-cols-2 gap-2">
                {defaultVariables.map((variable) => {
                  const selected = selectedVariables.includes(variable);
                  return (
                    <label key={variable} className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) => {
                          setSelectedVariables((prev) =>
                            checked ? [...new Set([...prev, variable])] : prev.filter((item) => item !== variable),
                          );
                        }}
                      />
                      {variable}
                    </label>
                  );
                })}
              </div>
            </div>
            <Button onClick={() => formulaMutation.mutate()} disabled={formulaMutation.isPending || !formulaName.trim()}>
              Save Formula
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create KPI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Widget Name</Label>
              <Input value={widgetName} onChange={(e) => setWidgetName(e.target.value)} placeholder="Main Occupancy KPI" />
            </div>
            <div className="space-y-2">
              <Label>Formula</Label>
              <Select value={widgetFormulaId} onValueChange={setWidgetFormulaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select formula" />
                </SelectTrigger>
                <SelectContent>
                  {formulas.map((formula) => (
                    <SelectItem key={formula.id} value={formula.id}>
                      {formula.name} {formula.is_system ? "(Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="widget-active">Widget Active</Label>
                <p className="text-xs text-muted-foreground">Inactive widgets are hidden on the dashboard main view.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{widgetIsVisible ? "Active" : "Not active"}</span>
                <Switch id="widget-active" checked={widgetIsVisible} onCheckedChange={setWidgetIsVisible} />
              </div>
            </div>
            <Button onClick={() => widgetMutation.mutate()} disabled={!widgetName || !widgetFormulaId || widgetMutation.isPending}>
              Save Widget
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Formulas</CardTitle>
          <CardDescription>Includes custom and default formulas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {formulas.map((formula) => (
            <div key={formula.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold">{formula.name}</p>
                <p className="text-xs text-muted-foreground">{formula.expression}</p>
              </div>
              <div className="flex items-center gap-2">
                {formula.is_system && <Badge variant="secondary">Default</Badge>}
                <Badge variant={formula.is_active ? "default" : "outline"}>{formula.is_active ? "Active" : "Inactive"}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manage KPIs</CardTitle>
          <CardDescription>Delete widgets you no longer need.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {widgets.map((widget) => (
            <div key={widget.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-semibold">{widget.name}</p>
                <p className="text-xs text-muted-foreground">{widget.is_visible ? "Active" : "Not active"}</p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setWidgetToDelete({ id: widget.id, name: widget.name })}
                disabled={deleteWidgetMutation.isPending}
              >
                Delete
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(widgetToDelete)} onOpenChange={(open) => !open && setWidgetToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete widget?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <span className="font-semibold">{widgetToDelete?.name}</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (widgetToDelete) {
                  deleteWidgetMutation.mutate(widgetToDelete.id);
                }
                setWidgetToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default KpiBuilderPage;
