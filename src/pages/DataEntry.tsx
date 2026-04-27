import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CalendarIcon, Download, FileSpreadsheet, LayoutGrid, Pencil, Table2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TimeCombobox } from "@/components/time-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { calendarDateToIsoDate, formatSaudiDateTime, getSaudiIsoDate, isoDateToCalendarDate } from "@/lib/date-time";
import {
  deleteBedSubmission,
  diffBedSubmission,
  fetchBedSubmissionById,
  fetchDepartments,
  fetchDepartmentTotalBeds,
  fetchFormFields,
  fetchKpiFormulas,
  fetchTodaySubmissions,
  fetchUserEntryPermissions,
  getCurrentUserId,
  saveBedSubmission,
  writeAuditLog,
} from "@/lib/supabase-api";
import { hasAnyRole } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import type { FormField } from "@/types/hospital";
import { utils, writeFileXLSX } from "xlsx";
import {
  buildRowScope,
  buildScopeWithFormulas,
  evaluateOccupancyRate,
  evaluateNamedFormula,
  findFormulaByName,
  formulaVariableKey,
} from "@/lib/formula-registry";
import type { KpiFormula } from "@/types/hospital";


const DataEntryPage = () => {
  const { roles, user, profile } = useAuth();
  const qc = useQueryClient();
  const saudiTodayForCalendar = useMemo(() => isoDateToCalendarDate(getSaudiIsoDate(new Date())), []);
  const canEditAllBedEntryFields = hasAnyRole(roles, ["admin", "staff"]);
  const isAdmin = hasAnyRole(roles, ["admin"]);
  const { data: userPerms } = useQuery({
    queryKey: ["user_entry_permissions", user?.id ?? "anon"],
    queryFn: () => fetchUserEntryPermissions(user!.id),
    enabled: Boolean(user?.id),
  });
  // Admin always has full permissions; otherwise use stored row (defaults: add+edit on, delete off)
  const canAdd = isAdmin || userPerms?.can_add !== false;
  const canEdit = isAdmin || userPerms?.can_edit !== false;
  const canDelete = isAdmin || userPerms?.can_delete === true;
  const canDeleteSubmissions = canDelete;
  const initialForm = {
    id: "",
    department_id: "",
    total_beds: 0,
    occupied: 0,
    closed: 0,
    closure_reason: "",
    custom_fields: {} as Record<string, unknown>,
  };

  const [form, setForm] = useState(initialForm);
  const [submissionView, setSubmissionView] = useState<"card" | "table">("card");
  const [submissionToDelete, setSubmissionToDelete] = useState<{ id: string; departmentName: string } | null>(null);
  const [missingFields, setMissingFields] = useState<Array<{ key: string; label: string }>>([]);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const setFieldRef = (key: string) => (el: HTMLElement | null) => {
    fieldRefs.current[key] = el;
  };
  const resetForm = () => setForm(initialForm);

  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const { data: departmentTotalBeds = {} } = useQuery({
    queryKey: ["department-total-beds"],
    queryFn: fetchDepartmentTotalBeds,
  });
  const { data: formFields = [] } = useQuery({ queryKey: ["form_fields"], queryFn: fetchFormFields });
  const { data: rows = [] } = useQuery({ queryKey: ["bed_submissions_today"], queryFn: fetchTodaySubmissions });
  const { data: kpiFormulas = [] } = useQuery({ queryKey: ["kpi_formulas"], queryFn: fetchKpiFormulas });

  const orderedActiveFields = useMemo(
    () => formFields.filter((field) => field.is_active).sort((a, b) => a.display_order - b.display_order),
    [formFields],
  );

  const dynamicFields = useMemo(
    () => formFields.filter((field) => field.is_active && !field.is_system).sort((a, b) => a.display_order - b.display_order),
    [formFields],
  );

  useEffect(() => {
    if (dynamicFields.length === 0) return;

    setForm((prev) => {
      const nextCustomFields = { ...prev.custom_fields };

      dynamicFields.forEach((field) => {
        const existing = nextCustomFields[field.field_key];
        if (existing !== undefined && existing !== null && String(existing) !== "") return;

        if (field.default_value !== null) {
          nextCustomFields[field.field_key] = field.default_value;
        }
      });

      return { ...prev, custom_fields: nextCustomFields };
    });
  }, [dynamicFields]);

  const canEditDynamicField = (field: FormField) => {
    if (canEditAllBedEntryFields) return true;
    return !field.is_readonly && (field.editable_roles.length === 0 || field.editable_roles.some((role) => roles.includes(role)));
  };

  const departmentNameById = useMemo(
    () => Object.fromEntries(departments.map((department) => [department.id, department.name])),
    [departments],
  );

  const computed = useMemo(() => {
    const total_beds = Number(form.total_beds) || 0;
    const occupied = Number(form.occupied) || 0;
    const closed = Number(form.closed) || 0;
    const fallbackVacant = Math.max(0, total_beds - occupied - closed);
    const scope = buildRowScope({
      total_beds,
      occupied,
      closed,
      custom_fields: form.custom_fields,
    });
    const { scope: resolvedScope, unresolved } = buildScopeWithFormulas(scope, kpiFormulas);
    const occupancyRate = evaluateOccupancyRate(kpiFormulas, resolvedScope);
    // Prefer admin-defined "Vacant" / "Occupied" formulas from KPI Builder;
    // fall back to the canonical math when no registry formula exists.
    const vacant = evaluateNamedFormula(kpiFormulas, "Vacant", resolvedScope, fallbackVacant);
    const occupiedAuto = evaluateNamedFormula(kpiFormulas, "Occupied", resolvedScope, occupied);
    const vacantFromFormula = Boolean(findFormulaByName(kpiFormulas, "Vacant"));
    const occupiedFromFormula = Boolean(findFormulaByName(kpiFormulas, "Occupied"));
    return {
      vacant,
      occupancyRate,
      occupiedAuto,
      vacantFromFormula,
      occupiedFromFormula,
      scope: resolvedScope,
      unresolved,
    };
  }, [form.total_beds, form.occupied, form.closed, form.custom_fields, kpiFormulas]);

  // Resolve a formula-type form field to its matching KPI formula and current value.
  // A formula field links to a KPI formula by sanitized name OR by exact label match.
  const resolveFormulaForField = (field: FormField): { formula: KpiFormula | undefined; value: number | null } => {
    // Try name-based match first (label === formula name)
    let formula = findFormulaByName(kpiFormulas, field.label);
    // Fallback: match by field_key against sanitized formula variable key
    if (!formula) {
      formula = kpiFormulas.find((f) => formulaVariableKey(f.name) === field.field_key);
    }
    if (!formula) return { formula: undefined, value: null };
    const key = formulaVariableKey(formula.name);
    const value = key in computed.scope ? computed.scope[key] : null;
    return { formula, value };
  };

  // Build the calculated_fields payload: include vacant + occupancy_rate (legacy)
  // PLUS every formula-type form field's resolved value.
  const buildCalculatedFieldsPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      vacant: computed.vacant,
      occupancy_rate: computed.occupancyRate,
      occupied_auto: computed.occupiedAuto,
    };
    orderedActiveFields
      .filter((field) => field.field_type === "formula" && field.is_active)
      .forEach((field) => {
        const { value } = resolveFormulaForField(field);
        payload[field.field_key] = value;
      });
    return payload;
  };

  const totalBedsNum = Number(form.total_beds) || 0;
  const occupiedNum = Number(form.occupied) || 0;
  const closedNum = Number(form.closed) || 0;
  const occupiedExceedsTotal = occupiedNum > totalBedsNum;
  // Per business rule: Vacant for Closed validation = Total Beds − Occupied
  const vacantForClosed = Math.max(0, totalBedsNum - occupiedNum);
  const closedExceedsVacant = closedNum > vacantForClosed && !occupiedExceedsTotal;
  const noVacantBeds = vacantForClosed === 0 && totalBedsNum > 0 && !occupiedExceedsTotal;

  // Auto-lock Closed to 0 when there are no vacant beds.
  useEffect(() => {
    if (noVacantBeds && form.closed !== 0) {
      setForm((prev) => ({ ...prev, closed: 0 }));
    }
  }, [noVacantBeds, form.closed]);

  const findRequiredDateField = () =>
    dynamicFields.find((field) => field.field_type === "date" && field.is_required);

  const findWaitingPatientsField = () =>
    dynamicFields.find((field) => {
      const key = field.field_key.toLowerCase();
      const label = field.label.toLowerCase();
      return key.includes("waiting") || label.includes("waiting");
    });

  const collectMissingFields = () => {
    const missing: Array<{ key: string; label: string }> = [];
    const dateField = findRequiredDateField();

    if (dateField) {
      const raw = String(form.custom_fields[dateField.field_key] ?? "");
      const [d = "", t = ""] = raw.split("T");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) missing.push({ key: `${dateField.field_key}__date`, label: "Date" });
      if (!/^\d{2}:\d{2}$/.test(t)) missing.push({ key: `${dateField.field_key}__time`, label: "Time" });
    }

    if (!form.department_id) missing.push({ key: "department_id", label: "Department" });
    if (!form.total_beds || Number(form.total_beds) <= 0) missing.push({ key: "total_beds", label: "Total Beds" });
    if (form.occupied === undefined || form.occupied === null || Number.isNaN(Number(form.occupied)))
      missing.push({ key: "occupied", label: "Occupied" });

    const waitingField = findWaitingPatientsField();
    if (waitingField) {
      const value = form.custom_fields[waitingField.field_key];
      const isEmpty = value === undefined || value === null || String(value).trim() === "";
      if (isEmpty) missing.push({ key: waitingField.field_key, label: waitingField.label });
    }

    return missing;
  };

  const exportRows = useMemo(
    () =>
      rows.map((row) => ({
        date: row.submitted_on,
        department: departmentNameById[row.department_id] ?? "Unknown Department",
        total_beds: row.total_beds,
        occupied: row.occupied,
        closed: row.closed,
        closure_reason: row.closure_reason ?? "",
        submitted_by: row.submitted_by,
      })),
    [rows, departmentNameById],
  );

  const getSubmissionDateTime = (row: (typeof rows)[number]) => {
    const createdAt = row.created_at ? new Date(row.created_at) : null;
    const fallbackDate = new Date(`${row.submitted_on}T00:00:00+03:00`);
    const sourceDate = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : fallbackDate;

    return {
      date: formatSaudiDateTime(sourceDate, { year: "numeric", month: "short", day: "numeric" }),
      time: formatSaudiDateTime(sourceDate, { hour: "2-digit", minute: "2-digit", hour12: false }),
    };
  };

  const handleEditSubmission = (row: (typeof rows)[number]) => {
    setForm({
      id: row.id,
      department_id: row.department_id,
      total_beds: row.total_beds,
      occupied: row.occupied,
      closed: row.closed,
      closure_reason: row.closure_reason ?? "",
      custom_fields: (row.custom_fields as Record<string, unknown>) ?? {},
    });
  };

  const downloadCsv = () => {
    if (exportRows.length === 0) {
      toast({ title: "No submissions", description: "There is no bed data to export for today.", variant: "destructive" });
      return;
    }

    const worksheet = utils.json_to_sheet(exportRows);
    const csv = utils.sheet_to_csv(worksheet);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bed_submissions_${getSaudiIsoDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadXlsx = () => {
    if (exportRows.length === 0) {
      toast({ title: "No submissions", description: "There is no bed data to export for today.", variant: "destructive" });
      return;
    }

    const worksheet = utils.json_to_sheet(exportRows);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Today_Submissions");
    writeFileXLSX(workbook, `bed_submissions_${getSaudiIsoDate(new Date())}.xlsx`);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.department_id) throw new Error("Department is required");
      if (form.closed > 0 && !form.closure_reason.trim()) throw new Error("Reason for closure is required");

      const missingRequiredDateField = dynamicFields.find((field) => {
        if (field.field_type !== "date" || !field.is_required) return false;
        const rawValue = form.custom_fields[field.field_key];
        if (rawValue === undefined || rawValue === null) return true;

        const normalizedValue = String(rawValue).trim();
        if (!normalizedValue) return true;

        const [datePart, timePart] = normalizedValue.split("T");
        const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(datePart ?? "");
        const hasValidTime = /^\d{2}:\d{2}$/.test(timePart ?? "");

        return !hasValidDate || !hasValidTime;
      });

      if (missingRequiredDateField) {
        throw new Error(`${missingRequiredDateField.label} is required and must include both date and time`);
      }

      const currentUserId = await getCurrentUserId();
      if (!currentUserId) throw new Error("No authenticated user");

        const submittedOn = getSaudiIsoDate(new Date());

        const isEdit = Boolean(form.id);
        const recordId = form.id || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined);

        // Capture before-state for audit (only on edit)
        const beforeRow = isEdit ? await fetchBedSubmissionById(form.id) : null;

        const payload = {
          id: recordId,
          department_id: form.department_id,
          bed_type_id: null,
          total_beds: canEditAllBedEntryFields ? Number(form.total_beds) : 0,
          occupied: Number(form.occupied),
          closed: Number(form.closed),
          closure_reason: form.closed > 0 ? form.closure_reason.trim() : null,
          submitted_on: submittedOn,
          custom_fields: form.custom_fields,
          calculated_fields: buildCalculatedFieldsPayload(),
          submitted_by: currentUserId,
          updated_by: currentUserId,
        } as const;

        await saveBedSubmission(roles, payload);

        // Write audit log (best-effort; do not fail the save if it errors)
        try {
          const action = isEdit ? "EDIT" : "ADD";
          const departmentName = departmentNameById[payload.department_id] ?? null;
          const changes = isEdit
            ? diffBedSubmission(beforeRow, payload)
            : diffBedSubmission(null, payload);
          await writeAuditLog({
            action,
            record_id: recordId ?? null,
            user_id: currentUserId,
            user_name: profile?.display_name ?? user?.email ?? null,
            department_name: departmentName,
            record_date: submittedOn,
            changes: isEdit ? changes : {},
          });
        } catch (logError) {
          console.warn("Audit log failed", logError);
        }
    },
    onSuccess: async () => {
      toast({ title: "Submission saved" });
      resetForm();
      await qc.invalidateQueries({ queryKey: ["bed_submissions_today"] });
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const beforeRow = await fetchBedSubmissionById(id);
      await deleteBedSubmission(roles, id);
      try {
        const currentUserId = await getCurrentUserId();
        if (currentUserId) {
          await writeAuditLog({
            action: "DELETE",
            record_id: id,
            user_id: currentUserId,
            user_name: profile?.display_name ?? user?.email ?? null,
            department_name: beforeRow ? (departmentNameById[beforeRow.department_id] ?? null) : null,
            record_date: beforeRow?.submitted_on ?? null,
            changes: {},
          });
        }
      } catch (logError) {
        console.warn("Audit log failed", logError);
      }
    },
    onSuccess: async () => {
      toast({ title: "Submission deleted" });
      await qc.invalidateQueries({ queryKey: ["bed_submissions_today"] });
      if (form.id) {
        resetForm();
      }
    },
    onError: (error) => toast({ title: "Delete failed", description: (error as Error).message, variant: "destructive" }),
  });


  const focusFieldByKey = (key: string) => {
    const el = fieldRefs.current[key];
    if (el && typeof (el as HTMLElement).focus === "function") {
      (el as HTMLElement).focus();
      if (typeof (el as HTMLElement).scrollIntoView === "function") {
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  const handleSaveClick = () => {
    const missing = collectMissingFields();
    if (missing.length > 0) {
      setMissingFields(missing);
      return;
    }
    if (occupiedExceedsTotal) {
      focusFieldByKey("occupied");
      return;
    }
    if (closedExceedsVacant) {
      focusFieldByKey("closed");
      return;
    }
    mutation.mutate();
  };

  const handleFixMissing = () => {
    const first = missingFields[0];
    setMissingFields([]);
    if (first) {
      // map combined date keys back to base key
      const baseKey = first.key.replace(/__(date|time)$/, "");
      setTimeout(() => focusFieldByKey(baseKey), 50);
    }
  };

  return (
    <section className="space-y-5 sm:space-y-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">Bed Data Entry</h1>
        <p className="text-sm text-muted-foreground">Admin and Staff can add/edit all Bed Entry fields; derived fields auto-calculate in real time.</p>
        <Badge variant="secondary" className="mt-2 w-fit">Timezone: Asia/Riyadh</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Daily Entry Form</CardTitle>
          <CardDescription>Closure Reason is mandatory only when Closed &gt; 0.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {orderedActiveFields.map((field) => {
            if (field.field_key === "department_id") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Select
                    value={form.department_id}
                    onValueChange={(value) =>
                      setForm((p) => ({
                        ...p,
                        department_id: value,
                        total_beds: departmentTotalBeds[value] ?? 0,
                      }))
                    }
                  >
                    <SelectTrigger ref={setFieldRef("department_id") as never}>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.filter((d) => d.is_active).map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            if (field.field_key === "bed_type_id") {
              return null;
            }

            if (field.field_key === "total_beds") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label} (auto)</Label>
                  <Input
                    ref={setFieldRef("total_beds") as never}
                    type="number"
                    min={0}
                    readOnly
                    value={form.total_beds}
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Auto-populated from the selected Department's capacity. Manage in Categories.
                  </p>
                </div>
              );
            }

            if (field.field_key === "occupied") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Input
                    ref={setFieldRef("occupied") as never}
                    type="number"
                    min={0}
                    value={form.occupied}
                    onChange={(e) => setForm((p) => ({ ...p, occupied: Number(e.target.value) }))}
                    aria-invalid={occupiedExceedsTotal}
                    className={cn(occupiedExceedsTotal && "border-destructive focus-visible:ring-destructive")}
                  />
                  {occupiedExceedsTotal ? (
                    <p className="text-sm font-medium text-destructive">
                      Occupied cannot exceed Total Beds ({totalBedsNum}).
                    </p>
                  ) : null}
                </div>
              );
            }

            if (field.field_key === "closed") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Input
                    ref={setFieldRef("closed") as never}
                    type="number"
                    min={0}
                    max={noVacantBeds ? 0 : undefined}
                    disabled={noVacantBeds}
                    value={noVacantBeds ? 0 : form.closed}
                    onChange={(e) => setForm((p) => ({ ...p, closed: Number(e.target.value) }))}
                    aria-invalid={closedExceedsVacant}
                    className={cn(closedExceedsVacant && "border-destructive focus-visible:ring-destructive")}
                  />
                  {closedExceedsVacant ? (
                    <p className="text-sm font-medium text-destructive">
                      Closed cannot exceed Vacant beds ({vacantForClosed}).
                    </p>
                  ) : null}
                  {noVacantBeds ? (
                    <p className="text-sm text-muted-foreground">No vacant beds — cannot close beds.</p>
                  ) : null}
                </div>
              );
            }

            if (field.field_key === "closure_reason") {
              if (form.closed <= 0) return null;
              return (
                <div key={field.id} className="space-y-2 md:col-span-2">
                  <Label>{field.label} *</Label>
                  <Textarea
                    value={form.closure_reason}
                    onChange={(e) => setForm((p) => ({ ...p, closure_reason: e.target.value }))}
                    placeholder="Required when Closed is greater than 0"
                  />
                </div>
              );
            }

            const editable = canEditDynamicField(field);
            const currentValue = form.custom_fields[field.field_key] ?? field.default_value ?? "";

            if (field.field_type === "formula") {
              const { formula, value } = resolveFormulaForField(field);
              const isUnresolved = formula
                ? Object.prototype.hasOwnProperty.call(computed.unresolved, formula.name)
                : true;
              const display =
                value === null || value === undefined || Number.isNaN(value)
                  ? "—"
                  : Number.isFinite(value)
                    ? Number(value).toFixed(2)
                    : "—";
              return (
                <div key={field.id} className="space-y-2 md:col-span-2">
                  <Label className="flex items-center gap-2">
                    {field.label}
                    <Badge variant="secondary" className="text-[10px] uppercase">Auto</Badge>
                  </Label>
                  <Input value={display} readOnly disabled className="bg-muted" />
                  {!formula ? (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      No matching KPI formula found for "{field.label}".
                    </p>
                  ) : isUnresolved ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Formula has unresolved variables — fill required inputs or fix in KPI Builder.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Calculated automatically from <code>{formula.expression}</code>
                    </p>
                  )}
                </div>
              );
            }

            if (field.field_type === "textarea") {
              return (
                <div key={field.id} className="space-y-2 md:col-span-2">
                  <Label>{field.label}{field.is_required ? " *" : ""}</Label>
                  <Textarea
                    disabled={!editable}
                    value={String(currentValue)}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        custom_fields: { ...prev.custom_fields, [field.field_key]: e.target.value },
                      }))
                    }
                  />
                </div>
              );
            }

            if (field.field_type === "select") {
              const options = Array.isArray(field.options) ? field.options : [];
              return (
                <div key={field.id} className="space-y-2 md:col-span-2">
                  <Label>{field.label}{field.is_required ? " *" : ""}</Label>
                  <Select
                    disabled={!editable}
                    value={String(currentValue)}
                    onValueChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        custom_fields: { ...prev.custom_fields, [field.field_key]: value },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            if (field.field_type === "boolean") {
              return (
                <div key={field.id} className="space-y-2 md:col-span-2">
                  <Label>{field.label}{field.is_required ? " *" : ""}</Label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      disabled={!editable}
                      checked={Boolean(currentValue === true || currentValue === "true")}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({
                          ...prev,
                          custom_fields: { ...prev.custom_fields, [field.field_key]: Boolean(checked) },
                        }))
                      }
                    />
                    <span className="text-muted-foreground">Enabled</span>
                  </label>
                </div>
              );
            }

            if (field.field_type === "date") {
              const raw = String(currentValue || "");
              const [rawDatePart, rawTimePart = ""] = raw.includes("T") ? raw.split("T") : [raw, ""];
              const datePart = /^\d{4}-\d{2}-\d{2}$/.test(rawDatePart) ? rawDatePart : "";
              const timePart = /^\d{2}:\d{2}$/.test(rawTimePart) ? rawTimePart : "";

              return (
                <div key={field.id} className="space-y-2 md:col-span-2">
                  <Label>{field.label}{field.is_required ? " *" : ""}</Label>
                  <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          ref={setFieldRef(field.field_key) as never}
                          variant="outline"
                          disabled={!editable}
                          className={cn(
                            "justify-start text-left font-normal",
                            !datePart && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {datePart ? format(isoDateToCalendarDate(datePart), "PPP") : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                           selected={datePart ? isoDateToCalendarDate(datePart) : undefined}
                          today={saudiTodayForCalendar}
                          onSelect={(selected) => {
                            if (!selected) return;
                             const nextDate = calendarDateToIsoDate(selected);
                            setForm((prev) => ({
                              ...prev,
                              custom_fields: {
                                ...prev.custom_fields,
                                [field.field_key]: timePart ? `${nextDate}T${timePart}` : nextDate,
                              },
                            }));
                          }}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>

                    <TimeCombobox
                      inputRef={setFieldRef(`${field.field_key}__time`) as never}
                      disabled={!editable}
                      value={timePart}
                      onChange={(nextTime) => {
                        setForm((prev) => ({
                          ...prev,
                          custom_fields: {
                            ...prev.custom_fields,
                            [field.field_key]: datePart ? `${datePart}T${nextTime}` : `T${nextTime}`,
                          },
                        }));
                      }}
                    />
                  </div>
                </div>
              );
            }

            const inputType = field.field_type === "number" ? "number" : "text";

            return (
              <div key={field.id} className="space-y-2 md:col-span-2">
                <Label>{field.label}{field.is_required ? " *" : ""}</Label>
                <Input
                  ref={setFieldRef(field.field_key) as never}
                  type={inputType}
                  disabled={!editable}
                  value={inputType === "number" ? Number(currentValue || 0) : String(currentValue)}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      custom_fields: {
                        ...prev.custom_fields,
                        [field.field_key]: inputType === "number" ? Number(e.target.value) : e.target.value,
                      },
                    }))
                  }
                />
              </div>
            );
          })}

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Vacant (auto)
              <Badge variant="secondary" className="text-[10px] uppercase">Auto</Badge>
            </Label>
            <Input
              value={Number.isFinite(computed.vacant) ? Number(computed.vacant).toFixed(0) : "—"}
              readOnly
              disabled
              className={cn(
                "bg-muted",
                computed.vacant === 0 && totalBedsNum > 0 && "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
              )}
            />
            <p className="text-xs text-muted-foreground">
              {computed.vacantFromFormula
                ? "Calculated from KPI Builder formula \u201CVacant\u201D."
                : "Default: Total Beds \u2212 Occupied \u2212 Closed."}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Occupied (auto)
              <Badge variant="secondary" className="text-[10px] uppercase">Auto</Badge>
            </Label>
            <Input
              value={Number.isFinite(computed.occupiedAuto) ? Number(computed.occupiedAuto).toFixed(0) : "—"}
              readOnly
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">
              {computed.occupiedFromFormula
                ? "Calculated from KPI Builder formula \u201COccupied\u201D."
                : "Mirrors the Occupied input."}
            </p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label className="flex items-center gap-2">
              Occupancy Rate (auto)
              <Badge variant="secondary" className="text-[10px] uppercase">Auto</Badge>
            </Label>
            <Input value={`${computed.occupancyRate.toFixed(1)}%`} readOnly disabled className="bg-muted" />
          </div>


          <div className="flex flex-col gap-2 sm:flex-row md:col-span-2">
            {(form.id ? canEdit : canAdd) ? (
              <Button onClick={handleSaveClick} disabled={mutation.isPending}>
                {form.id ? "Save Changes" : "Add New Entry"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                You don't have permission to {form.id ? "edit" : "add"} bed entries.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={resetForm}
              disabled={mutation.isPending || deleteMutation.isPending}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today’s Submissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="inline-flex w-full rounded-md border p-1 sm:w-auto">
              <Button
                type="button"
                variant={submissionView === "card" ? "default" : "ghost"}
                size="sm"
                onClick={() => setSubmissionView("card")}
                className="flex-1 sm:flex-none"
              >
                <LayoutGrid className="mr-2 h-4 w-4" />
                Card View
              </Button>
              <Button
                type="button"
                variant={submissionView === "table" ? "default" : "ghost"}
                size="sm"
                onClick={() => setSubmissionView("table")}
                className="flex-1 sm:flex-none"
              >
                <Table2 className="mr-2 h-4 w-4" />
                Table View
              </Button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" size="sm" onClick={downloadCsv}>
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={downloadXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Download XLSX
              </Button>
            </div>
          </div>

          {rows.length === 0 && <p className="text-sm text-muted-foreground">No submissions yet.</p>}
          {submissionView === "card"
            ? rows.map((row) => {
                const dateTime = getSubmissionDateTime(row);

                return (
                  <div key={row.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 space-y-1 text-left">
                      <p className="text-sm text-muted-foreground">
                        Date: {dateTime.date} • Time: {dateTime.time}
                      </p>
                      <p className="font-semibold">Department: {departmentNameById[row.department_id] ?? "Unknown Department"}</p>
                      <p className="text-sm text-muted-foreground">
                        Total {row.total_beds} • Occupied {row.occupied} • Closed {row.closed}
                      </p>
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                      {canEdit ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditSubmission(row)}
                          className="w-full sm:w-auto"
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                      ) : null}

                      {canDeleteSubmissions ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setSubmissionToDelete({
                              id: row.id,
                              departmentName: departmentNameById[row.department_id] ?? "Unknown Department",
                            })
                          }
                          className="w-full sm:w-auto"
                          disabled={deleteMutation.isPending}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            : rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Occupied</TableHead>
                        <TableHead className="text-right">Closed</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => {
                        const dateTime = getSubmissionDateTime(row);

                        return (
                          <TableRow key={row.id}>
                            <TableCell>{dateTime.date}</TableCell>
                            <TableCell>{dateTime.time}</TableCell>
                            <TableCell>{departmentNameById[row.department_id] ?? "Unknown Department"}</TableCell>
                            <TableCell className="text-right">{row.total_beds}</TableCell>
                            <TableCell className="text-right">{row.occupied}</TableCell>
                            <TableCell className="text-right">{row.closed}</TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                {canEdit ? (
                                  <Button type="button" size="sm" variant="outline" onClick={() => handleEditSubmission(row)}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit
                                  </Button>
                                ) : null}
                                {canDeleteSubmissions ? (
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() =>
                                      setSubmissionToDelete({
                                        id: row.id,
                                        departmentName: departmentNameById[row.department_id] ?? "Unknown Department",
                                      })
                                    }
                                    disabled={deleteMutation.isPending}
                                  >
                                    Delete
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(submissionToDelete)}
        onOpenChange={(open) => {
          if (!open) setSubmissionToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this submission?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The submission for <span className="font-medium">{submissionToDelete?.departmentName}</span> will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!submissionToDelete) return;
                deleteMutation.mutate(submissionToDelete.id, {
                  onSettled: () => setSubmissionToDelete(null),
                });
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={missingFields.length > 0}
        onOpenChange={(open) => {
          if (!open) setMissingFields([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
              Please complete the following fields
            </DialogTitle>
            <DialogDescription>
              These fields are required before you can save this entry.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            {missingFields.map((f) => (
              <li key={f.key} className="font-medium">
                {f.label}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={handleFixMissing}>Go Back &amp; Fix</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default DataEntryPage;
