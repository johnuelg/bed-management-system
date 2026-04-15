import { supabase } from "@/integrations/supabase/client";
import { requireRole } from "@/lib/api-guard";
import { compressImageIfNeeded, MAX_UPLOAD_SIZE, validateFileType } from "@/lib/file-upload";
import { evaluateSafeExpression } from "@/lib/math-eval";
import { bedSubmissionSchema, formulaSchema } from "@/lib/validation";
import type { AppRole, BedSubmission, BedType, Department, FormField, KpiFormula, KpiWidget, Profile } from "@/types/hospital";

const db = supabase as any;

export const getCurrentUserId = async () => {
  const { data } = await supabase.auth.getUser();
  return data.user?.id;
};

export const fetchProfiles = async (): Promise<Profile[]> => {
  const { data, error } = await db.from("profiles").select("id,user_id,display_name,is_active").order("display_name", { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const fetchUserRoles = async (userId?: string): Promise<Record<string, AppRole[]>> => {
  let query = db.from("user_roles").select("user_id,role");
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).reduce((acc: Record<string, AppRole[]>, row: { user_id: string; role: AppRole }) => {
    acc[row.user_id] = [...(acc[row.user_id] ?? []), row.role];
    return acc;
  }, {});
};

export const setUserRole = async (roles: AppRole[], targetUserId: string, role: AppRole) => {
  requireRole(roles, ["admin"], "manage user roles");
  await db.from("user_roles").delete().eq("user_id", targetUserId);
  const { error } = await db.from("user_roles").insert({ user_id: targetUserId, role });
  if (error) throw error;
};

export const createUserByAdmin = async (roles: AppRole[], payload: { email: string; password: string; display_name: string; role: AppRole }) => {
  requireRole(roles, ["admin"], "create users");
  const { data, error } = await supabase.functions.invoke("admin-user-management", {
    body: { action: "create_user", ...payload },
  });
  if (error) throw error;
  return data;
};

export const deactivateUserByAdmin = async (roles: AppRole[], user_id: string, is_active: boolean) => {
  requireRole(roles, ["admin"], "update users");
  const { data, error } = await supabase.functions.invoke("admin-user-management", {
    body: { action: "set_user_active", user_id, is_active },
  });
  if (error) throw error;
  return data;
};

export const fetchDepartments = async (): Promise<Department[]> => {
  const { data, error } = await db.from("departments").select("id,name,code,sort_order,is_active").order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const saveDepartment = async (roles: AppRole[], input: Partial<Department> & { name: string; code: string }) => {
  requireRole(roles, ["admin"], "manage departments");
  const { error } = await db.from("departments").upsert(input, { onConflict: "code" });
  if (error) throw error;
};

export const toggleDepartmentActive = async (roles: AppRole[], id: string, is_active: boolean) => {
  requireRole(roles, ["admin"], "manage departments");
  const { error } = await db.from("departments").update({ is_active }).eq("id", id);
  if (error) throw error;
};

export const fetchBedTypes = async (): Promise<BedType[]> => {
  const { data, error } = await db.from("bed_types").select("id,name,sort_order,is_active").order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const saveBedType = async (roles: AppRole[], input: Partial<BedType> & { name: string }) => {
  requireRole(roles, ["admin"], "manage bed types");
  const { error } = await db.from("bed_types").upsert(input, { onConflict: "name" });
  if (error) throw error;
};

export const toggleBedTypeActive = async (roles: AppRole[], id: string, is_active: boolean) => {
  requireRole(roles, ["admin"], "manage bed types");
  const { error } = await db.from("bed_types").update({ is_active }).eq("id", id);
  if (error) throw error;
};

export const fetchFormFields = async (): Promise<FormField[]> => {
  const { data, error } = await db.from("form_fields").select("*").order("display_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const saveFormField = async (roles: AppRole[], field: Partial<FormField> & { field_key: string; label: string; field_type: FormField["field_type"] }) => {
  requireRole(roles, ["admin"], "manage form builder");
  const { error } = await db.from("form_fields").upsert(field, { onConflict: "field_key" });
  if (error) throw error;
};

export const replaceFormFieldOrder = async (roles: AppRole[], orderedIds: string[]) => {
  requireRole(roles, ["admin"], "reorder form fields");
  await Promise.all(
    orderedIds.map((id, index) =>
      db.from("form_fields").update({ display_order: index + 1 }).eq("id", id),
    ),
  );
};

export const fetchTodaySubmissions = async (): Promise<BedSubmission[]> => {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("bed_submissions")
    .select("*")
    .eq("submitted_on", today)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const saveBedSubmission = async (
  roles: AppRole[],
  input: Omit<BedSubmission, "id" | "created_at"> & { id?: string },
) => {
  const normalized = {
    ...input,
    total_beds: Number(input.total_beds),
    occupied: Number(input.occupied),
    closed: Number(input.closed),
  };

  bedSubmissionSchema.parse(normalized);

  if (!roles.some((role) => ["admin", "director", "doctor", "nurse", "staff"].includes(role))) {
    throw new Error("Unauthorized: cannot submit bed records.");
  }

  const { error } = await db.from("bed_submissions").upsert(normalized);
  if (error) throw error;
};

export const fetchKpiFormulas = async (): Promise<KpiFormula[]> => {
  const { data, error } = await db.from("kpi_formulas").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const saveKpiFormula = async (roles: AppRole[], formula: Omit<KpiFormula, "id" | "is_system"> & { id?: string }) => {
  requireRole(roles, ["admin", "director"], "manage KPI formulas");
  formulaSchema.parse(formula);
  const { error } = await db.from("kpi_formulas").upsert(formula, { onConflict: "name" });
  if (error) throw error;
};

export const fetchKpiWidgets = async (): Promise<KpiWidget[]> => {
  const { data, error } = await db.from("kpi_widgets").select("*").order("display_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export const saveKpiWidget = async (roles: AppRole[], widget: Omit<KpiWidget, "id"> & { id?: string }) => {
  requireRole(roles, ["admin", "director"], "manage KPI widgets");
  const { error } = await db.from("kpi_widgets").upsert(widget, { onConflict: "name" });
  if (error) throw error;
};

export const evaluateFormulaFromRow = (expression: string, row: Record<string, number>) => evaluateSafeExpression(expression, row);

export const aggregateSubmissionSums = (rows: Array<Pick<BedSubmission, "total_beds" | "occupied" | "closed">>) =>
  rows.reduce(
    (acc, row) => ({
      total_beds: acc.total_beds + (Number(row.total_beds) || 0),
      occupied: acc.occupied + (Number(row.occupied) || 0),
      closed: acc.closed + (Number(row.closed) || 0),
      vacant: acc.vacant + Math.max((Number(row.total_beds) || 0) - (Number(row.occupied) || 0) - (Number(row.closed) || 0), 0),
    }),
    { total_beds: 0, occupied: 0, closed: 0, vacant: 0 } as { total_beds: number; occupied: number; closed: number; vacant: number },
  );

export const uploadDocument = async (userId: string, file: File) => {
  if (!validateFileType(file)) {
    throw new Error("Unsupported file type. Allowed: .csv, .xlsx, .pdf, .doc, .png, .jpg");
  }

  let finalFile = file;
  if (file.type.startsWith("image/")) {
    finalFile = await compressImageIfNeeded(file);
  }

  if (finalFile.size > MAX_UPLOAD_SIZE) {
    throw new Error("File must be 2MB or less after compression.");
  }

  const path = `${userId}/${Date.now()}-${finalFile.name}`;
  const { error } = await supabase.storage.from("documents").upload(path, finalFile, {
    upsert: false,
    contentType: finalFile.type,
  });
  if (error) throw error;
  return path;
};
