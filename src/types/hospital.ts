export type SystemRole = "admin" | "director" | "doctor" | "nurse" | "staff";

export type AppRole = string;

export type Profile = {
  id: string;
  user_id: string;
  display_name: string | null;
  is_active: boolean;
};

export type Department = {
  id: string;
  name: string;
  code: string;
  sort_order: number;
  is_active: boolean;
};

export type BedType = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type FormFieldType = "number" | "text" | "textarea" | "select" | "boolean" | "date" | "formula";

export type FormField = {
  id: string;
  field_key: string;
  label: string;
  field_type: FormFieldType;
  is_required: boolean;
  is_readonly: boolean;
  is_system: boolean;
  is_active: boolean;
  display_order: number;
  default_value: string | null;
  options: Array<{ label: string; value: string }>;
  editable_roles: AppRole[];
};

export type BedSubmission = {
  id: string;
  department_id: string;
  bed_type_id: string | null;
  total_beds: number;
  occupied: number;
  closed: number;
  closure_reason: string | null;
  submitted_on: string;
  custom_fields: Record<string, unknown>;
  calculated_fields: Record<string, unknown>;
  submitted_by: string;
  updated_by: string | null;
  created_at: string;
};

export type KpiFormula = {
  id: string;
  name: string;
  expression: string;
  variables: string[];
  is_active: boolean;
  is_system: boolean;
};

export type KpiWidget = {
  id: string;
  name: string;
  formula_id: string | null;
  aggregation_scope: string;
  is_visible: boolean;
  display_order: number;
  refresh_seconds: number;
};

export type RoleMenuVisibility = {
  dashboard: boolean;
  data_entry: boolean;
  kpi_builder: boolean;
  categories: boolean;
  form_builder: boolean;
  users: boolean;
};

export type ClinicalRole = "doctor" | "nurse" | "staff";

export type NavRole = SystemRole;

export type NavVisibilitySettings = Record<string, RoleMenuVisibility>;

export type OccupancyBenchmarkLevel = {
  key: "low" | "optimal" | "watch" | "high";
  label: string;
  threshold: string;
  minPercent: number | null;
  maxPercent: number | null;
  minInclusive: boolean;
  maxInclusive: boolean;
  color: string;
};

export type OccupancyBenchmarkSettings = {
  levels: OccupancyBenchmarkLevel[];
};
