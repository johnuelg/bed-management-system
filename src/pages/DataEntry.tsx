import { useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  deleteBedSubmission,
  fetchBedTypes,
  fetchDepartments,
  fetchTodaySubmissions,
  getCurrentUserId,
  saveBedSubmission,
  uploadDocument,
} from "@/lib/supabase-api";
import { MAX_UPLOAD_SIZE } from "@/lib/file-upload";
import { hasAnyRole } from "@/lib/rbac";

const fileSchema = z.custom<File>((val) => val instanceof File).superRefine((file, ctx) => {
  if (file.size > MAX_UPLOAD_SIZE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "File must be <= 2MB" });
  }
});

const DataEntryPage = () => {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const canManageTotals = hasAnyRole(roles, ["admin", "director"]);
  const canDeleteSubmissions = hasAnyRole(roles, ["admin", "director"]);
  const initialForm = {
    id: "",
    department_id: "",
    bed_type_id: "",
    total_beds: 0,
    occupied: 0,
    closed: 0,
    closure_reason: "",
  };

  const [form, setForm] = useState(initialForm);
  const resetForm = () => setForm(initialForm);

  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const { data: bedTypes = [] } = useQuery({ queryKey: ["bed_types"], queryFn: fetchBedTypes });
  const { data: rows = [] } = useQuery({ queryKey: ["bed_submissions_today"], queryFn: fetchTodaySubmissions });

  const computed = useMemo(() => {
    const vacant = Math.max(0, Number(form.total_beds) - Number(form.occupied) - Number(form.closed));
    const occupancyRate = form.total_beds > 0 ? (Number(form.occupied) / Number(form.total_beds)) * 100 : 0;
    return { vacant, occupancyRate };
  }, [form.total_beds, form.occupied, form.closed]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.department_id) throw new Error("Department is required");
      if (form.closed > 0 && !form.closure_reason.trim()) throw new Error("Reason for closure is required");

      const currentUserId = await getCurrentUserId();
      if (!currentUserId) throw new Error("No authenticated user");

      return saveBedSubmission(roles, {
        id: form.id || undefined,
        department_id: form.department_id,
        bed_type_id: form.bed_type_id || null,
        total_beds: canManageTotals ? Number(form.total_beds) : 0,
        occupied: Number(form.occupied),
        closed: Number(form.closed),
        closure_reason: form.closed > 0 ? form.closure_reason.trim() : null,
        submitted_on: new Date().toISOString().slice(0, 10),
        custom_fields: {},
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
        <p className="text-sm text-muted-foreground">Staff can edit Occupied/Closed; derived fields auto-calculate in real time.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Daily Entry Form</CardTitle>
          <CardDescription>Closure Reason is mandatory only when Closed &gt; 0.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Department</Label>
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

          <div className="space-y-2">
            <Label>Bed Type</Label>
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

          <div className="space-y-2">
            <Label>Total Beds</Label>
            <Input
              type="number"
              min={0}
              disabled={!canManageTotals}
              value={form.total_beds}
              onChange={(e) => setForm((p) => ({ ...p, total_beds: Number(e.target.value) }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Occupied</Label>
            <Input type="number" min={0} value={form.occupied} onChange={(e) => setForm((p) => ({ ...p, occupied: Number(e.target.value) }))} />
          </div>
          <div className="space-y-2">
            <Label>Closed</Label>
            <Input type="number" min={0} value={form.closed} onChange={(e) => setForm((p) => ({ ...p, closed: Number(e.target.value) }))} />
          </div>
          <div className="space-y-2">
            <Label>Vacant (auto)</Label>
            <Input value={computed.vacant} readOnly />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Occupancy Rate (auto)</Label>
            <Input value={`${computed.occupancyRate.toFixed(1)}%`} readOnly />
          </div>

          {form.closed > 0 && (
            <div className="space-y-2 md:col-span-2">
              <Label>Reason for Closure *</Label>
              <Textarea
                value={form.closure_reason}
                onChange={(e) => setForm((p) => ({ ...p, closure_reason: e.target.value }))}
                placeholder="Required when Closed is greater than 0"
              />
            </div>
          )}

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

          <div className="md:col-span-2">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              Save Entry
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
                  })
                }
              >
                <p className="font-semibold">Department: {row.department_id}</p>
                <p className="text-sm text-muted-foreground">
                  Total {row.total_beds} • Occupied {row.occupied} • Closed {row.closed}
                </p>
              </button>

              {canDeleteSubmissions ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => deleteMutation.mutate(row.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
};

export default DataEntryPage;
