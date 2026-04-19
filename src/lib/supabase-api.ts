import { supabase } from "@/integrations/supabase/client";
import { requireRole } from "@/lib/api-guard";
import { compressImageIfNeeded, MAX_UPLOAD_SIZE, validateFileType } from "@/lib/file-upload";
import { evaluateSafeExpression } from "@/lib/math-eval";
import { bedSubmissionSchema, formulaSchema } from "@/lib/validation";
import type {
  AppRole,
  BedSubmission,
  BedType,
  Department,
  FormField,
  KpiFormula,
  KpiWidget,
  NavVisibilitySettings,
  RoleMenuVisibility,
  Profile,
} from "@/types/hospital";

const db = supabase as any;
const NAV_VISIBILITY_KEY = "nav_visibility";
const ROLE_CATALOG_KEY = "role_catalog";
const DEFAULT_ROLE_CATALOG: AppRole[] = ["admin", "director", "doctor", "nurse", "staff"];
const DEFAULT_ROLE_MENU_VISIBILITY: RoleMenuVisibility = {
  dashboard: true,
  data_entry: true,
  kpi_builder: true,
  categories: true,
  form_builder: true,
  users: true,
};
const DEFAULT_NAV_VISIBILITY: NavVisibilitySettings = {
  admin: { ...DEFAULT_ROLE_MENU_VISIBILITY },
  director: { ...DEFAULT_ROLE_MENU_VISIBILITY },
  doctor: { ...DEFAULT_ROLE_MENU_VISIBILITY },
  nurse: { ...DEFAULT_ROLE_MENU_VISIBILITY },
  staff: { ...DEFAULT_ROLE_MENU_VISIBILITY },
};
const SAUDI_TIMEZONE = "Asia/Riyadh";

const getDatePartsInTimezone = (value: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not format date in timezone ${timeZone}`);
  }

  return { year, month, day };
};

const getSaudiDateString = (value = new Date()) => {
  const { year, month, day } = getDatePartsInTimezone(value, SAUDI_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const normalizeRoleMenuVisibility = (value: unknown): RoleMenuVisibility => {
  if (!value || typeof value !== "object") return { ...DEFAULT_ROLE_MENU_VISIBILITY };
  const source = value as Partial<Record<keyof RoleMenuVisibility, unknown>>;
  return {
    dashboard: typeof source.dashboard === "boolean" ? source.dashboard : true,
    data_entry: typeof source.data_entry === "boolean" ? source.data_entry : true,
    kpi_builder: typeof source.kpi_builder === "boolean" ? source.kpi_builder : true,
    categories: typeof source.categories === "boolean" ? source.categories : true,
    form_builder: typeof source.form_builder === "boolean" ? source.form_builder : true,
    users: typeof source.users === "boolean" ? source.users : true,
  };
};

const normalizeNavVisibility = (value: unknown): NavVisibilitySettings => {
  if (!value || typeof value !== "object") return DEFAULT_NAV_VISIBILITY;
  const source = value as Record<string, unknown>;

  const normalizedEntries = Object.entries(source)
    .filter(([role]) => role.trim().length > 0)
    .map(([role, roleValue]) => [role, normalizeRoleMenuVisibility(roleValue)] as const);

  const base = {
    admin: { ...DEFAULT_ROLE_MENU_VISIBILITY },
    director: { ...DEFAULT_ROLE_MENU_VISIBILITY },
    doctor: { ...DEFAULT_ROLE_MENU_VISIBILITY },
    nurse: { ...DEFAULT_ROLE_MENU_VISIBILITY },
    staff: { ...DEFAULT_ROLE_MENU_VISIBILITY },
  };

  if (normalizedEntries.length === 0) {
    return base;
  }

  return {
    ...base,
    ...Object.fromEntries(normalizedEntries),
  };
};

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

  return (data ?? []).reduce((acc: Record<string, AppRole[]>, row: { user_id: string; role: string }) => {
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

export const fetchNavVisibilitySettings = async (): Promise<NavVisibilitySettings> => {
  const { data, error } = await db
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", NAV_VISIBILITY_KEY)
    .maybeSingle();
  if (error) throw error;
  return normalizeNavVisibility(data?.setting_value);
};

export const saveNavVisibilitySettings = async (
  roles: AppRole[],
  settings: NavVisibilitySettings,
  userId: string,
) => {
  requireRole(roles, ["admin"], "manage navigation settings");
  const { error } = await db.from("app_settings").upsert(
    {
      setting_key: NAV_VISIBILITY_KEY,
      setting_value: settings,
      updated_by: userId,
    },
    { onConflict: "setting_key" },
  );
  if (error) throw error;
};

export const fetchRoleCatalog = async (): Promise<AppRole[]> => {
  const { data, error } = await db
    .from("app_settings")
    .select("setting_value")
    .eq("setting_key", ROLE_CATALOG_KEY)
    .maybeSingle();

  if (error) throw error;

  const values = data?.setting_value;
  if (!Array.isArray(values)) return DEFAULT_ROLE_CATALOG;

  const cleaned = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  const deduped = cleaned.length > 0 ? Array.from(new Set(cleaned)) : DEFAULT_ROLE_CATALOG;
  return deduped.includes("admin") ? deduped : ["admin", ...deduped];
};

export const saveRoleCatalog = async (roles: AppRole[], roleCatalog: AppRole[], userId: string) => {
  requireRole(roles, ["admin"], "manage roles catalog");

  const cleaned = Array.from(
    new Set(
      roleCatalog
        .map((role) => role.trim())
        .filter(Boolean),
    ),
  );

  const baseCatalog = cleaned.length > 0 ? cleaned : DEFAULT_ROLE_CATALOG;
  const finalCatalog = baseCatalog.includes("admin") ? baseCatalog : ["admin", ...baseCatalog];

  const { error } = await db.from("app_settings").upsert(
    {
      setting_key: ROLE_CATALOG_KEY,
      setting_value: finalCatalog,
      updated_by: userId,
    },
    { onConflict: "setting_key" },
  );

  if (error) throw error;
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

export const updateDepartment = async (
  roles: AppRole[],
  id: string,
  input: { name: string; code: string },
) => {
  requireRole(roles, ["admin"], "manage departments");
  const { error } = await db.from("departments").update(input).eq("id", id);
  if (error) throw error;
};

export const deleteDepartment = async (roles: AppRole[], id: string) => {
  requireRole(roles, ["admin"], "manage departments");
  const { error } = await db.from("departments").delete().eq("id", id);
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

export const updateBedType = async (
  roles: AppRole[],
  id: string,
  input: { name: string },
) => {
  requireRole(roles, ["admin"], "manage bed types");
  const { error } = await db.from("bed_types").update(input).eq("id", id);
  if (error) throw error;
};

export const deleteBedType = async (roles: AppRole[], id: string) => {
  requireRole(roles, ["admin"], "manage bed types");
  const { error } = await db.from("bed_types").delete().eq("id", id);
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

export const updateFormField = async (
  roles: AppRole[],
  id: string,
  field: Partial<FormField> & { field_key: string; label: string; field_type: FormField["field_type"] },
) => {
  requireRole(roles, ["admin"], "manage form builder");
  const { error } = await db.from("form_fields").update(field).eq("id", id);
  if (error) throw error;
};

export const deleteFormField = async (roles: AppRole[], id: string) => {
  requireRole(roles, ["admin"], "manage form builder");
  const { error } = await db.from("form_fields").delete().eq("id", id);
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
  const today = getSaudiDateString();
  const { data, error } = await db
    .from("bed_submissions")
    .select("*")
    .eq("submitted_on", today)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const fetchSubmissionsByDateRange = async (startDate: string, endDate: string): Promise<BedSubmission[]> => {
  const from = startDate <= endDate ? startDate : endDate;
  const to = startDate <= endDate ? endDate : startDate;

  const { data, error } = await db
    .from("bed_submissions")
    .select("*")
    .gte("submitted_on", from)
    .lte("submitted_on", to)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
};

export const fetchDashboardSubmissions = async (): Promise<BedSubmission[]> => {
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allRows: BedSubmission[] = [];

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await db
      .from("bed_submissions")
      .select("*")
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const chunk = (data ?? []) as BedSubmission[];
    allRows.push(...chunk);
    hasMore = chunk.length === pageSize;
    from += pageSize;
  }

  return allRows;
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

export const deleteBedSubmission = async (roles: AppRole[], id: string) => {
  requireRole(roles, ["admin", "director"], "delete bed submissions");
  const { error } = await db.from("bed_submissions").delete().eq("id", id);
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

export const deleteKpiWidget = async (roles: AppRole[], id: string) => {
  requireRole(roles, ["admin", "director"], "manage KPI widgets");
  const { error } = await db.from("kpi_widgets").delete().eq("id", id);
  if (error) throw error;
};

export const evaluateFormulaFromRow = (expression: string, row: Record<string, number>) => evaluateSafeExpression(expression, row);

export const aggregateSubmissionSums = (rows: Array<Pick<BedSubmission, "total_beds" | "occupied" | "closed">>) =>
  rows.reduce<{ total_beds: number; occupied: number; closed: number; vacant: number }>(
    (acc, row) => ({
      total_beds: acc.total_beds + (Number(row.total_beds) || 0),
      occupied: acc.occupied + (Number(row.occupied) || 0),
      closed: acc.closed + (Number(row.closed) || 0),
      vacant: acc.vacant + Math.max((Number(row.total_beds) || 0) - (Number(row.occupied) || 0) - (Number(row.closed) || 0), 0),
    }),
    { total_beds: 0, occupied: 0, closed: 0, vacant: 0 },
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
