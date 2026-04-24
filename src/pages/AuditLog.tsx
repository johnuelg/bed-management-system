import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAuditLogs, fetchDepartments } from "@/lib/supabase-api";
import { formatSaudiDateTime, formatSaudiIsoDateForDisplay } from "@/lib/date-time";
import type { AuditAction, AuditLogEntry } from "@/types/hospital";
import { cn } from "@/lib/utils";

const actionMeta: Record<AuditAction, { label: string; Icon: typeof Plus; className: string }> = {
  ADD: { label: "ADD", Icon: Plus, className: "text-violet-600 dark:text-violet-400" },
  EDIT: { label: "EDIT", Icon: Pencil, className: "text-amber-600 dark:text-amber-400" },
  DELETE: { label: "DELETE", Icon: Trash2, className: "text-rose-600 dark:text-rose-400" },
};

const formatChange = (key: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const friendlyKey = (key: string) =>
  key
    .replace(/^custom\./, "")
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());

const renderChanges = (entry: AuditLogEntry, departmentMap: Map<string, string>) => {
  if (entry.action === "ADD" || entry.action === "DELETE") return "—";
  const keys = Object.keys(entry.changes ?? {});
  if (keys.length === 0) return "—";
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {keys.map((key) => {
        const change = entry.changes[key] ?? {};
        const isDeptId = key === "department_id";
        const fromVal = isDeptId ? departmentMap.get(String(change.from)) ?? change.from : change.from;
        const toVal = isDeptId ? departmentMap.get(String(change.to)) ?? change.to : change.to;
        return (
          <span key={key} className="rounded bg-muted px-2 py-0.5">
            <span className="font-medium">{friendlyKey(key)}:</span>{" "}
            <span className="text-muted-foreground">{formatChange(key, fromVal)}</span>
            <span className="mx-1">→</span>
            <span>{formatChange(key, toVal)}</span>
          </span>
        );
      })}
    </div>
  );
};

const AuditLogPage = () => {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit_logs"],
    queryFn: () => fetchAuditLogs(500),
  });
  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });

  const departmentMap = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  return (
    <section className="space-y-5 sm:space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Full history of every Add, Edit, and Delete action on bed entries.
          </p>
          <Badge variant="secondary" className="mt-2 w-fit">Timezone: Asia/Riyadh</Badge>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="h-4 w-4" />
          {logs.length} {logs.length === 1 ? "entry" : "entries"}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Activity History</CardTitle>
          <CardDescription>Most recent actions appear first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User Name</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Date of Record</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((entry) => {
                    const meta = actionMeta[entry.action];
                    const timestampLabel = entry.created_at
                      ? `${formatSaudiDateTime(new Date(entry.created_at), { year: "numeric", month: "short", day: "numeric" })}, ${formatSaudiDateTime(new Date(entry.created_at), { hour: "2-digit", minute: "2-digit", hour12: true })}`
                      : "—";
                    const recordDateLabel = entry.record_date
                      ? formatSaudiIsoDateForDisplay(entry.record_date, { year: "numeric", month: "short", day: "numeric" })
                      : "—";
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap text-sm">{timestampLabel}</TableCell>
                        <TableCell className="text-sm">{entry.user_name ?? "Unknown"}</TableCell>
                        <TableCell>
                          <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", meta.className)}>
                            <meta.Icon className="h-4 w-4" />
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{entry.department_name ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{recordDateLabel}</TableCell>
                        <TableCell>{renderChanges(entry, departmentMap)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};

export default AuditLogPage;