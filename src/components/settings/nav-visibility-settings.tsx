import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ClinicalRole, NavVisibilitySettings, RoleMenuVisibility } from "@/types/hospital";

type Props = {
  settings: NavVisibilitySettings;
  disabled?: boolean;
  onChange: (next: NavVisibilitySettings) => void;
};

const roleRows: Array<{ key: ClinicalRole; label: string }> = [
  { key: "doctor", label: "Doctor" },
  { key: "nurse", label: "Nurse" },
  { key: "staff", label: "Staff" },
];

const settingRows: Array<{ key: keyof RoleMenuVisibility; label: string; description: string }> = [
  { key: "dashboard", label: "Dashboard", description: "Show or hide Dashboard in the sidebar menu." },
  { key: "data_entry", label: "Bed Entry", description: "Show or hide Bed Entry in the sidebar menu." },
  { key: "kpi_builder", label: "KPI Builder", description: "Show or hide KPI Builder in the sidebar menu." },
];

export const NavVisibilitySettingsEditor = ({ settings, disabled, onChange }: Props) => (
  <div className="space-y-5">
    {roleRows.map((roleRow) => (
      <div key={roleRow.key} className="space-y-3 rounded-md border p-3">
        <h3 className="text-sm font-semibold">{roleRow.label}</h3>
        {settingRows.map((row) => (
          <div key={`${roleRow.key}-${row.key}`} className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <Label>{row.label}</Label>
              <p className="text-xs text-muted-foreground">{row.description}</p>
            </div>
            <Switch
              checked={settings[roleRow.key][row.key]}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({
                  ...settings,
                  [roleRow.key]: {
                    ...settings[roleRow.key],
                    [row.key]: checked,
                  },
                })
              }
              aria-label={`Toggle ${row.label} menu for ${roleRow.label}`}
            />
          </div>
        ))}
      </div>
    ))}
  </div>
);