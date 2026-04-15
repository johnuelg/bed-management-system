import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import {
  aggregateSubmissionSums,
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

  const { data: formulas = [] } = useQuery({ queryKey: ["kpi_formulas"], queryFn: fetchKpiFormulas });
  const { data: widgets = [] } = useQuery({ queryKey: ["kpi_widgets"], queryFn: fetchKpiWidgets });
  const { data: rows = [] } = useQuery({ queryKey: ["bed_submissions_today"], queryFn: fetchTodaySubmissions });

  const sums = useMemo(() => aggregateSubmissionSums(rows), [rows]);

  const formulaValues = useMemo(() => {
    const map: Record<string, number> = {};
    for (const formula of formulas.filter((f) => f.is_active)) {
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
        is_visible: true,
        display_order: widgets.length + 1,
        refresh_seconds: 30,
      }),
    onSuccess: async () => {
      toast({ title: "Widget saved" });
      setWidgetName("");
      await qc.invalidateQueries({ queryKey: ["kpi_widgets"] });
    },
    onError: (error) => toast({ title: "Widget save failed", description: (error as Error).message, variant: "destructive" }),
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
            <CardTitle>Create Widget</CardTitle>
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
                      {formula.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => widgetMutation.mutate()} disabled={!widgetName || !widgetFormulaId || widgetMutation.isPending}>
              Save Widget
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live KPI Preview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {widgets.filter((w) => w.is_visible).map((widget) => {
            const value = formulaValues[widget.formula_id ?? ""];
            return (
              <div key={widget.id} className="hospital-glass rounded-lg p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{widget.aggregation_scope}</p>
                <p className="mt-2 text-sm font-semibold">{widget.name}</p>
                <p className="mt-1 text-3xl font-bold">
                  {Number.isFinite(value) ? value.toFixed(2) : "--"}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
};

export default KpiBuilderPage;
