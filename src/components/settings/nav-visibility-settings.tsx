import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { NavVisibilitySettings } from "@/types/hospital";

type Props = {
  settings: NavVisibilitySettings;
  disabled?: boolean;
  onChange: (next: NavVisibilitySettings) => void;
};

const settingRows: Array<{ key: keyof NavVisibilitySettings; label: string; description: string }> = [
  { key: "dashboard", label: "Dashboard", description: "Show or hide Dashboard in the sidebar menu." },
  { key: "data_entry", label: "Bed Entry", description: "Show or hide Bed Entry in the sidebar menu." },
  { key: "kpi_builder", label: "KPI Builder", description: "Show or hide KPI Builder in the sidebar menu." },
];

export const NavVisibilitySettingsEditor = ({ settings, disabled, onChange }: Props) => (
  <div className="space-y-4">
    {settingRows.map((row) => (
      <div key={row.key} className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-1">
          <Label>{row.label}</Label>
          <p className="text-xs text-muted-foreground">{row.description}</p>
        </div>
        <Switch
          checked={settings[row.key]}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...settings, [row.key]: checked })}
          aria-label={`Toggle ${row.label} menu`}
        />
      </div>
    ))}
  </div>
);