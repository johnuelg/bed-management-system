import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

const fileSchema = z.custom<File>((val) => val instanceof File).superRefine((file, ctx) => {
  if (file.size > MAX_UPLOAD_SIZE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "File must be <= 2MB" });
  }
});

const toLocalDateString = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toLocalTimeString = (value: Date) => {
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
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

      return saveBedSubmission(roles, {
        id: form.id || undefined,
        department_id: form.department_id,
        bed_type_id: form.bed_type_id || null,
        total_beds: canEditAllBedEntryFields ? Number(form.total_beds) : 0,
        occupied: Number(form.occupied),
        closed: Number(form.closed),
        closure_reason: form.closed > 0 ? form.closure_reason.trim() : null,
        submitted_on: new Date().toISOString().slice(0, 10),
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
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Bed Data Entry</h1>
        <p className="text-sm text-muted-foreground">Admin and Staff can add/edit all Bed Entry fields; derived fields auto-calculate in real time.</p>
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

          <div className="md:col-span-2 flex flex-wrap gap-2">
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
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No submissions yet.</p>}
          {rows.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
              <button
                type="button"
                className="hospital-transition flex-1 text-left hover:bg-muted"
                onClick={() =>
                  setForm({
                    id: row.id,
                    department_id: row.department_id,
                    bed_type_id: row.bed_type_id ?? "",
                    total_beds: row.total_beds,
                    occupied: row.occupied,
                    closed: row.closed,
                    closure_reason: row.closure_reason ?? "",
                    custom_fields: (row.custom_fields as Record<string, unknown>) ?? {},
                  })
                }
              >
                <p className="font-semibold">Department: {departmentNameById[row.department_id] ?? "Unknown Department"}</p>
                <p className="text-sm text-muted-foreground">
                  Bed Type: {row.bed_type_id ? (bedTypeNameById[row.bed_type_id] ?? "Unknown Bed Type") : "Not specified"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Total {row.total_beds} • Occupied {row.occupied} • Closed {row.closed}
                </p>
              </button>

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
          ))}
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
