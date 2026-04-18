import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, Download, FileSpreadsheet, LayoutGrid, Pencil, Table2 } from "lucide-react";
import { z } from "zod";
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
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  deleteBedSubmission,
  fetchBedTypes,
  fetchDepartments,
  fetchFormFields,
  fetchTodaySubmissions,
  getCurrentUserId,
  saveBedSubmission,
  uploadDocument,
} from "@/lib/supabase-api";
import { MAX_UPLOAD_SIZE } from "@/lib/file-upload";
import { hasAnyRole } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import type { FormField } from "@/types/hospital";
import { utils, writeFileXLSX } from "xlsx";

const fileSchema = z.custom<File>((val) => val instanceof File).superRefine((file, ctx) => {
  if (file.size > MAX_UPLOAD_SIZE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "File must be <= 2MB" });
  }
});

const SAUDI_TIMEZONE = "Asia/Riyadh";

const getDateTimePartsInTimezone = (value: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (!year || !month || !day || !hour || !minute) {
    throw new Error(`Could not format datetime in timezone ${timeZone}`);
  }

  return { year, month, day, hour, minute };
};

const toLocalDateString = (value: Date) => {
  const { year, month, day } = getDateTimePartsInTimezone(value, SAUDI_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const toLocalTimeString = (value: Date) => {
  const { hour, minute } = getDateTimePartsInTimezone(value, SAUDI_TIMEZONE);
  return `${hour}:${minute}`;
};

const getCurrentDateTimeValue = () => {
  const now = new Date();
  return `${toLocalDateString(now)}T${toLocalTimeString(now)}`;
};

const DataEntryPage = () => {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const canEditAllBedEntryFields = hasAnyRole(roles, ["admin", "staff"]);
  const canDeleteSubmissions = hasAnyRole(roles, ["admin", "director"]);
  const initialForm = {
    id: "",
    department_id: "",
    bed_type_id: "",
    total_beds: 0,
    occupied: 0,
    closed: 0,
    closure_reason: "",
    custom_fields: {} as Record<string, unknown>,
  };

  const [form, setForm] = useState(initialForm);
  const [submissionView, setSubmissionView] = useState<"card" | "table">("card");
  const [submissionToDelete, setSubmissionToDelete] = useState<{ id: string; departmentName: string } | null>(null);
  const resetForm = () => setForm(initialForm);

  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const { data: bedTypes = [] } = useQuery({ queryKey: ["bed_types"], queryFn: fetchBedTypes });
  const { data: formFields = [] } = useQuery({ queryKey: ["form_fields"], queryFn: fetchFormFields });
  const { data: rows = [] } = useQuery({ queryKey: ["bed_submissions_today"], queryFn: fetchTodaySubmissions });

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

        if (field.field_type === "date") {
          nextCustomFields[field.field_key] = getCurrentDateTimeValue();
          return;
        }

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

  const bedTypeNameById = useMemo(
    () => Object.fromEntries(bedTypes.map((bedType) => [bedType.id, bedType.name])),
    [bedTypes],
  );

  const computed = useMemo(() => {
    const vacant = Math.max(0, Number(form.total_beds) - Number(form.occupied) - Number(form.closed));
    const occupancyRate = form.total_beds > 0 ? (Number(form.occupied) / Number(form.total_beds)) * 100 : 0;
    return { vacant, occupancyRate };
  }, [form.total_beds, form.occupied, form.closed]);

  const exportRows = useMemo(
    () =>
      rows.map((row) => ({
        date: row.submitted_on,
        department: departmentNameById[row.department_id] ?? "Unknown Department",
        bed_type: row.bed_type_id ? (bedTypeNameById[row.bed_type_id] ?? "Unknown Bed Type") : "Not specified",
        total_beds: row.total_beds,
        occupied: row.occupied,
        closed: row.closed,
        closure_reason: row.closure_reason ?? "",
        submitted_by: row.submitted_by,
      })),
    [rows, departmentNameById, bedTypeNameById],
  );

  const getSubmissionDateTime = (row: (typeof rows)[number]) => {
    const createdAt = row.created_at ? new Date(row.created_at) : null;
    const fallbackDate = new Date(`${row.submitted_on}T00:00:00+03:00`);
    const sourceDate = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : fallbackDate;

    return {
      date: new Intl.DateTimeFormat("en-US", {
        timeZone: SAUDI_TIMEZONE,
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(sourceDate),
      time: new Intl.DateTimeFormat("en-US", {
        timeZone: SAUDI_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(sourceDate),
    };
  };

  const handleEditSubmission = (row: (typeof rows)[number]) => {
    setForm({
      id: row.id,
      department_id: row.department_id,
      bed_type_id: row.bed_type_id ?? "",
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
    link.download = `bed_submissions_${toLocalDateString(new Date())}.csv`;
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
    writeFileXLSX(workbook, `bed_submissions_${toLocalDateString(new Date())}.xlsx`);
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

        const submittedOn = toLocalDateString(new Date());

        return saveBedSubmission(roles, {
        id: form.id || undefined,
        department_id: form.department_id,
        bed_type_id: form.bed_type_id || null,
        total_beds: canEditAllBedEntryFields ? Number(form.total_beds) : 0,
        occupied: Number(form.occupied),
        closed: Number(form.closed),
        closure_reason: form.closed > 0 ? form.closure_reason.trim() : null,
          submitted_on: submittedOn,
        custom_fields: form.custom_fields,
        calculated_fields: { vacant: computed.vacant, occupancy_rate: computed.occupancyRate },
        submitted_by: currentUserId,
        updated_by: currentUserId,
      });
    },
    onSuccess: async () => {
      toast({ title: "Submission saved" });
      resetForm();
      await qc.invalidateQueries({ queryKey: ["bed_submissions_today"] });
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBedSubmission(roles, id),
    onSuccess: async () => {
      toast({ title: "Submission deleted" });
      await qc.invalidateQueries({ queryKey: ["bed_submissions_today"] });
      if (form.id) {
        resetForm();
      }
    },
    onError: (error) => toast({ title: "Delete failed", description: (error as Error).message, variant: "destructive" }),
  });

  const onUpload = async (file?: File) => {
    if (!file) return;
    const parsed = fileSchema.safeParse(file);
    if (!parsed.success) {
      toast({ title: "Upload rejected", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }

    try {
      const currentUserId = await getCurrentUserId();
      if (!currentUserId) throw new Error("No authenticated user");
      await uploadDocument(currentUserId, file);
      toast({ title: "Document uploaded" });
    } catch (error) {
      toast({ title: "Upload failed", description: (error as Error).message, variant: "destructive" });
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
                  <Select value={form.department_id} onValueChange={(value) => setForm((p) => ({ ...p, department_id: value }))}>
                    <SelectTrigger>
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
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Select value={form.bed_type_id} onValueChange={(value) => setForm((p) => ({ ...p, bed_type_id: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      {bedTypes.filter((b) => b.is_active).map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }

            if (field.field_key === "total_beds") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Input
                    type="number"
                    min={0}
                    disabled={!canEditAllBedEntryFields}
                    value={form.total_beds}
                    onChange={(e) => setForm((p) => ({ ...p, total_beds: Number(e.target.value) }))}
                  />
                </div>
              );
            }

            if (field.field_key === "occupied") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Input type="number" min={0} value={form.occupied} onChange={(e) => setForm((p) => ({ ...p, occupied: Number(e.target.value) }))} />
                </div>
              );
            }

            if (field.field_key === "closed") {
              return (
                <div key={field.id} className="space-y-2">
                  <Label>{field.label}</Label>
                  <Input type="number" min={0} value={form.closed} onChange={(e) => setForm((p) => ({ ...p, closed: Number(e.target.value) }))} />
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

            if (field.field_type === "formula") return null;

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
              const [datePart, timePart] = raw.includes("T")
                ? raw.split("T")
                : [raw || toLocalDateString(new Date()), toLocalTimeString(new Date())];

              return (
                <div key={field.id} className="space-y-2 md:col-span-2">
                  <Label>{field.label}{field.is_required ? " *" : ""}</Label>
                  <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!editable}
                          className={cn(
                            "justify-start text-left font-normal",
                            !datePart && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {datePart ? format(new Date(`${datePart}T00:00:00`), "PPP") : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={datePart ? new Date(`${datePart}T00:00:00`) : undefined}
                          onSelect={(selected) => {
                            if (!selected) return;
                            const nextDate = toLocalDateString(selected);
                            const safeTime = timePart || toLocalTimeString(new Date());
                            setForm((prev) => ({
                              ...prev,
                              custom_fields: {
                                ...prev.custom_fields,
                                [field.field_key]: `${nextDate}T${safeTime}`,
                              },
                            }));
                          }}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>

                    <Input
                      type="time"
                      step={60}
                      disabled={!editable}
                      value={timePart || toLocalTimeString(new Date())}
                      onChange={(e) => {
                        const safeDate = datePart || toLocalDateString(new Date());
                        setForm((prev) => ({
                          ...prev,
                          custom_fields: {
                            ...prev.custom_fields,
                            [field.field_key]: `${safeDate}T${e.target.value}`,
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
            <Label>Vacant (auto)</Label>
            <Input value={computed.vacant} readOnly />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Occupancy Rate (auto)</Label>
            <Input value={`${computed.occupancyRate.toFixed(1)}%`} readOnly />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Upload Document (2MB max)</Label>
            <Input
              type="file"
              accept=".csv,.xlsx,.pdf,.doc,.png,.jpg,.jpeg"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                void onUpload(e.target.files?.[0]);
              }}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row md:col-span-2">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              Save Entry
            </Button>
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
                        Bed Type: {row.bed_type_id ? (bedTypeNameById[row.bed_type_id] ?? "Unknown Bed Type") : "Not specified"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Total {row.total_beds} • Occupied {row.occupied} • Closed {row.closed}
                      </p>
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
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
                        <TableHead>Bed Type</TableHead>
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
                            <TableCell>{row.bed_type_id ? (bedTypeNameById[row.bed_type_id] ?? "Unknown Bed Type") : "Not specified"}</TableCell>
                            <TableCell className="text-right">{row.total_beds}</TableCell>
                            <TableCell className="text-right">{row.occupied}</TableCell>
                            <TableCell className="text-right">{row.closed}</TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => handleEditSubmission(row)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Edit
                                </Button>
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
    </section>
  );
};

export default DataEntryPage;
