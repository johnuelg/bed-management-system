import { Label } from "@/components/ui/label";
import type { NavRole, NavVisibilitySettings, RoleMenuVisibility } from "@/types/hospital";
import { Check, Circle } from "lucide-react";

type Props = {
  settings: NavVisibilitySettings;
  disabled?: boolean;
  onChange: (next: NavVisibilitySettings) => void;
};

const roleRows: Array<{ key: NavRole; label: string; dotClass: string }> = [
  { key: "director", label: "Director", dotClass: "text-secondary-foreground" },
  { key: "doctor", label: "Doctor", dotClass: "text-primary" },
  { key: "nurse", label: "Nurse", dotClass: "text-primary" },
  { key: "staff", label: "Data Collector", dotClass: "text-accent-foreground" },
  { key: "admin", label: "Administrator", dotClass: "text-ring" },
];

const settingRows: Array<{ key: keyof RoleMenuVisibility; label: string; description: string }> = [
  { key: "dashboard", label: "Dashboard", description: "Show or hide Dashboard in the sidebar menu." },
  { key: "data_entry", label: "Bed Entry", description: "Show or hide Bed Entry in the sidebar menu." },
  { key: "kpi_builder", label: "KPI Builder", description: "Show or hide KPI Builder in the sidebar menu." },
  { key: "settings", label: "Settings", description: "Show or hide Settings in the sidebar menu." },
  { key: "categories", label: "Categories", description: "Show or hide Categories in the sidebar menu." },
  { key: "form_builder", label: "Form Builder", description: "Show or hide Form Builder in the sidebar menu." },
  { key: "users", label: "Users", description: "Show or hide Users in the sidebar menu." },
];

export const NavVisibilitySettingsEditor = ({ settings, disabled, onChange }: Props) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-2xl font-bold">Navigation Permissions</h3>
      <p className="text-sm text-muted-foreground">Control which navigation menu items each role can access</p>
    </div>

    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-4 py-4 text-left text-base font-semibold text-muted-foreground">Navigation Item</th>
            {roleRows.map((roleRow) => (
              <th key={roleRow.key} className="px-4 py-4 text-left text-base font-semibold">
                <div className="inline-flex items-center gap-2">
                  <Circle className={`h-3.5 w-3.5 fill-current ${roleRow.dotClass ?? "text-primary"}`} />
                  <span>{roleRow.label}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {settingRows.map((row) => (
            <tr key={row.key} className="border-b last:border-b-0">
              <td className="px-4 py-5 align-middle">
                <div className="space-y-1">
                  <Label className="text-xl font-semibold text-foreground">{row.label}</Label>
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                </div>
              </td>
              {roleRows.map((roleRow) => (
                <td key={`${row.key}-${roleRow.key}`} className="px-4 py-5 align-middle">
                  <div className="flex items-center justify-start">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={settings[roleRow.key][row.key]}
                      aria-label={`Toggle ${row.label} menu for ${roleRow.label}`}
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...settings,
                          [roleRow.key]: {
                            ...settings[roleRow.key],
                            [row.key]: !settings[roleRow.key][row.key],
                          },
                        })
                      }
                      className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                        settings[roleRow.key][row.key]
                          ? "border-primary text-primary"
                          : "border-border text-muted-foreground/40"
                      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary/70"}`}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);