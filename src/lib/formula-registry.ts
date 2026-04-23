import { evaluateSafeExpression } from "@/lib/math-eval";
import type { BedSubmission, KpiFormula } from "@/types/hospital";

/**
 * Global Formula Registry.
 *
 * All KPI calculations across Dashboard tables, charts, and KPI cards
 * MUST go through this module. No formula should be hardcoded elsewhere.
 *
 * Built-in variables available to every formula:
 *  - total_beds, occupied, closed, vacant
 *  - waiting_patients
 *
 * Custom variables resolve from `bed_submission.custom_fields` (numeric only).
 */

export type FormulaScope = Record<string, number>;

const WAITING_KEY_HINT = (key: string) =>
  key.toLowerCase().includes("waiting") && key.toLowerCase().includes("patient");

const toNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const extractWaitingPatients = (custom: Record<string, unknown>): number => {
  const direct = custom.waiting_patients ?? (custom as Record<string, unknown>).waitingPatients;
  if (direct !== undefined) return toNumber(direct);
  const detected = Object.entries(custom).find(([key]) => WAITING_KEY_HINT(key));
  return detected ? toNumber(detected[1]) : 0;
};

/** Build a scope (variable → numeric value) for a single submission row. */
export const buildRowScope = (
  row: Pick<BedSubmission, "total_beds" | "occupied" | "closed"> & {
    custom_fields?: Record<string, unknown> | null;
  },
): FormulaScope => {
  const total_beds = toNumber(row.total_beds);
  const occupied = toNumber(row.occupied);
  const closed = toNumber(row.closed);
  const vacant = Math.max(total_beds - occupied - closed, 0);
  const custom = (row.custom_fields ?? {}) as Record<string, unknown>;
  const waiting_patients = extractWaitingPatients(custom);

  const scope: FormulaScope = {
    total_beds,
    occupied,
    closed,
    vacant,
    waiting_patients,
  };

  // Add numeric custom_fields under sanitized keys
  for (const [key, value] of Object.entries(custom)) {
    const safeKey = key.replace(/[^a-zA-Z0-9_]/g, "_");
    if (!(safeKey in scope) && (typeof value === "number" || typeof value === "string")) {
      const num = Number(value);
      if (Number.isFinite(num)) scope[safeKey] = num;
    }
  }

  return scope;
};

/** Build an aggregate scope (SUM-based) across many rows. */
export const buildAggregateScope = (
  rows: Array<
    Pick<BedSubmission, "total_beds" | "occupied" | "closed"> & {
      custom_fields?: Record<string, unknown> | null;
    }
  >,
): FormulaScope => {
  const acc: FormulaScope = {
    total_beds: 0,
    occupied: 0,
    closed: 0,
    vacant: 0,
    waiting_patients: 0,
  };

  for (const row of rows) {
    const rowScope = buildRowScope(row);
    for (const [key, value] of Object.entries(rowScope)) {
      acc[key] = (acc[key] ?? 0) + value;
    }
  }

  return acc;
};

/**
 * Evaluate a single formula safely. Returns null when the formula is
 * inactive, missing, or the expression fails to evaluate.
 */
export const evaluateFormula = (
  formula: Pick<KpiFormula, "expression" | "is_active"> | null | undefined,
  scope: FormulaScope,
): number | null => {
  if (!formula || !formula.is_active) return null;
  try {
    return evaluateSafeExpression(formula.expression, scope);
  } catch {
    return null;
  }
};

/** Find a formula in the global registry by case-insensitive name match. */
export const findFormulaByName = (
  formulas: KpiFormula[],
  name: string,
): KpiFormula | undefined => {
  const target = name.trim().toLowerCase();
  return formulas.find((formula) => formula.name.trim().toLowerCase() === target);
};

/**
 * Evaluate every active formula in the registry against the provided scope.
 * Returns a map keyed by formula name → numeric result (or null on failure).
 */
export const evaluateAllFormulas = (
  formulas: KpiFormula[],
  scope: FormulaScope,
): Record<string, number | null> => {
  const out: Record<string, number | null> = {};
  for (const formula of formulas) {
    if (!formula.is_active) continue;
    out[formula.name] = evaluateFormula(formula, scope);
  }
  return out;
};

/**
 * Convenience: evaluate the registered "Occupancy Rate" formula. Falls back
 * to the canonical `occupied / total_beds * 100` only if no active formula
 * with that name exists in the registry.
 */
export const evaluateOccupancyRate = (
  formulas: KpiFormula[],
  scope: FormulaScope,
): number => {
  const formula = findFormulaByName(formulas, "Occupancy Rate");
  const result = evaluateFormula(formula, scope);
  if (result !== null) return result;
  return scope.total_beds > 0 ? (scope.occupied / scope.total_beds) * 100 : 0;
};