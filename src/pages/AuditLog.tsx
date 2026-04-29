import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, History, Search, X, CalendarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { fetchAuditLogs, fetchDepartments } from "@/lib/supabase-api";
import {
  formatSaudiDateTime,
  formatSaudiIsoDateForDisplay,
  calendarDateToIsoDate,
  getSaudiIsoDate,
} from "@/lib/date-time";
import type { AuditAction, AuditLogEntry } from "@/types/hospital";
import { cn } from "@/lib/utils";

const actionMeta: Record<AuditAction, { label: string; Icon: typeof Plus; className: string; badge: string }> = {
  ADD: {
    label: "ADD",
    Icon: Plus,
    className: "text-violet-600 dark:text-violet-400",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  },
  EDIT: {
    label: "EDIT",
    Icon: Pencil,
    className: "text-amber-600 dark:text-amber-400",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  DELETE: {
    label: "DELETE",
    Icon: Trash2,
    className: "text-rose-600 dark:text-rose-400",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  },
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

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | AuditAction>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();

  const filteredLogs = useMemo(() => {
    const fromIso = fromDate ? calendarDateToIsoDate(fromDate) : null;
    const toIso = toDate ? calendarDateToIsoDate(toDate) : null;
    const q = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (actionFilter !== "all" && entry.action !== actionFilter) return false;
      if (deptFilter !== "all" && entry.department_name !== deptFilter) return false;
      if (fromIso || toIso) {
        const entryIso = entry.created_at ? getSaudiIsoDate(new Date(entry.created_at)) : null;
        if (!entryIso) return false;
        if (fromIso && entryIso < fromIso) return false;
        if (toIso && entryIso > toIso) return false;
      }
      if (q) {
        const hay = [
          entry.user_name,
          entry.department_name,
          entry.action,
          entry.record_date,
          JSON.stringify(entry.changes ?? {}),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, actionFilter, deptFilter, fromDate, toDate]);

  const hasActiveFilters = search || actionFilter !== "all" || deptFilter !== "all" || fromDate || toDate;
  const clearFilters = () => {
    setSearch("");
    setActionFilter("all");
    setDeptFilter("all");
    setFromDate(undefined);
    setToDate(undefined);
  };

  const departmentNames = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => l.department_name && set.add(l.department_name));
    return Array.from(set).sort();
  }, [logs]);

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
          {filteredLogs.length} of {logs.length} {logs.length === 1 ? "entry" : "entries"}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Activity History</CardTitle>
          <CardDescription>Most recent actions appear first.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search user, department, changes…"
                className="pl-9"
              />
            </div>
            <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as typeof actionFilter)}>
              <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="ADD">Add</SelectItem>
                <SelectItem value="EDIT">Edit</SelectItem>
                <SelectItem value="DELETE">Delete</SelectItem>
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departmentNames.map((n) => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("flex-1 justify-start text-left font-normal", !fromDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? formatSaudiDateTime(fromDate, { month: "short", day: "numeric" }) : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("flex-1 justify-start text-left font-normal", !toDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? formatSaudiDateTime(toDate, { month: "short", day: "numeric" }) : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {hasActiveFilters && (
            <div className="mb-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Clear filters
              </Button>
            </div>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filteredLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {logs.length === 0 ? "No audit entries yet." : "No entries match the current filters."}
            </p>
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
                  {filteredLogs.map((entry) => {
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
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold", meta.badge)}>
                            <meta.Icon className="h-3.5 w-3.5" />
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