import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, Download, FileText, RotateCcw, ArrowUpDown, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { DateRange } from "react-day-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { hasAnyRole } from "@/lib/rbac";
import { useToast } from "@/hooks/use-toast";
import {
  calendarDateToIsoDate,
  formatSaudiIsoDateForDisplay,
  isoDateToCalendarDate,
} from "@/lib/date-time";
import { buildRowScope, evaluateOccupancyRate } from "@/lib/formula-registry";
import {
  deleteAllBedSubmissions,
  deleteBedSubmission,
  fetchDashboardSubmissions,
  fetchDepartments,
  fetchKpiFormulas,
  fetchOccupancyBenchmarkSettings,
} from "@/lib/supabase-api";
import type { BedSubmission, OccupancyBenchmarkLevel } from "@/types/hospital";

type SortKey =
  | "date"
  | "time"
  | "department"
  | "total_beds"
  | "occupied"
  | "closed"
  | "vacant"
  | "waiting"
  | "occupancy";

type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const DEFAULT_BENCHMARK: OccupancyBenchmarkLevel[] = [
  { key: "low", label: "Low", threshold: "< 60%", minPercent: null, maxPercent: 60, minInclusive: false, maxInclusive: false, color: "#16a34a", icon: "thumbs-up" },
  { key: "optimal", label: "Optimal", threshold: "60% – 84%", minPercent: 60, maxPercent: 84, minInclusive: true, maxInclusive: true, color: "#16a34a", icon: "check" },
  { key: "watch", label: "Watch", threshold: "85% – 89%", minPercent: 85, maxPercent: 89, minInclusive: true, maxInclusive: true, color: "#f59e0b", icon: "eye" },
  { key: "high", label: "High", threshold: "≥ 90%", minPercent: 90, maxPercent: null, minInclusive: true, maxInclusive: false, color: "#dc2626", icon: "alert-triangle" },
];

const extractUserInputDateTime = (row: BedSubmission) => {
  const customFields = (row.custom_fields as Record<string, unknown>) ?? {};
  for (const value of Object.values(customFields)) {
    if (typeof value !== "string") continue;
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
    if (match) return { date: match[1], time: match[2] };
  }
  return null;
};

const extractWaiting = (row: BedSubmission) => {
  const customFields = (row.custom_fields as Record<string, unknown>) ?? {};
  const direct = customFields.waiting_patients ?? customFields.waitingPatients;
  if (typeof direct === "number") return direct;
  if (typeof direct === "string") return Number(direct) || 0;
  const detected = Object.entries(customFields).find(([key]) =>
    key.toLowerCase().includes("waiting") && key.toLowerCase().includes("patient"),
  )?.[1];
  if (typeof detected === "number") return detected;
  if (typeof detected === "string") return Number(detected) || 0;
  return 0;
};

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return (Number.isNaN(hours) ? 0 : hours) * 60 + (Number.isNaN(minutes) ? 0 : minutes);
};

const csvEscape = (value: unknown) => {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

const DataTablePage = () => {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const { toast } = useToast();
  const canDelete = hasAnyRole(roles, ["admin", "director"]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Defaults: unfiltered (no date range, all times, all depts, all bed types)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [timeFrom, setTimeFrom] = useState("00:00");
  const [timeTo, setTimeTo] = useState("23:59");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("all");

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const { data: rows = [] } = useQuery({
    queryKey: ["bed_submissions_dashboard"],
    queryFn: fetchDashboardSubmissions,
  });
  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const { data: occupancyBenchmark } = useQuery({
    queryKey: ["app_settings", "occupancy_benchmark"],
    queryFn: fetchOccupancyBenchmarkSettings,
  });
  const { data: kpiFormulas = [] } = useQuery({ queryKey: ["kpi_formulas"], queryFn: fetchKpiFormulas });

  const benchmarkLevels = occupancyBenchmark?.levels ?? DEFAULT_BENCHMARK;
  const getOccupancyBenchmark = (value: number) =>
    benchmarkLevels.find((level) => {
      const minPass = level.minPercent === null ? true : level.minInclusive ? value >= level.minPercent : value > level.minPercent;
      const maxPass = level.maxPercent === null ? true : level.maxInclusive ? value <= level.maxPercent : value < level.maxPercent;
      return minPass && maxPass;
    }) ?? benchmarkLevels[benchmarkLevels.length - 1];

  const departmentMap = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  const dateFilteredRows = useMemo(() => {
    const fromMinutes = toMinutes(timeFrom);
    const toMinutesValue = toMinutes(timeTo);
    const wrapsMidnight = fromMinutes > toMinutesValue;
    const dateFromIso = dateRange?.from ? calendarDateToIsoDate(dateRange.from) : null;
    const dateToIso = dateRange?.to
      ? calendarDateToIsoDate(dateRange.to)
      : dateRange?.from
        ? calendarDateToIsoDate(dateRange.from)
        : null;
    const lowerDate = dateFromIso && dateToIso && dateFromIso > dateToIso ? dateToIso : dateFromIso;
    const upperDate = dateFromIso && dateToIso && dateFromIso > dateToIso ? dateFromIso : dateToIso;

    return rows.filter((row) => {
      const userDateTime = extractUserInputDateTime(row);
      if (!userDateTime) return false;
      if (lowerDate && userDateTime.date < lowerDate) return false;
      if (upperDate && userDateTime.date > upperDate) return false;

      const minutes = toMinutes(userDateTime.time);
      if (wrapsMidnight) {
        if (!(minutes >= fromMinutes || minutes <= toMinutesValue)) return false;
      } else {
        if (!(minutes >= fromMinutes && minutes <= toMinutesValue)) return false;
      }
      return true;
    });
  }, [rows, timeFrom, timeTo, dateRange]);

  const departmentOptions = useMemo(() => {
    const ids = new Set(
      dateFilteredRows.map((row) => row.department_id),
    );
    return departments.filter((d) => ids.has(d.id));
  }, [dateFilteredRows, departments]);

  useEffect(() => {
    if (selectedDepartmentId !== "all" && !departmentOptions.some((d) => d.id === selectedDepartmentId)) {
      setSelectedDepartmentId("all");
    }
  }, [departmentOptions, selectedDepartmentId]);

  const filteredRows = useMemo(
    () =>
      dateFilteredRows.filter((row) => {
        if (selectedDepartmentId !== "all" && row.department_id !== selectedDepartmentId) return false;
        return true;
      }),
    [dateFilteredRows, selectedDepartmentId],
  );

  const enrichedRows = useMemo(() => {
    return filteredRows.map((row) => {
      const dt = extractUserInputDateTime(row);
      const vacant = Math.max((Number(row.total_beds) || 0) - (Number(row.occupied) || 0) - (Number(row.closed) || 0), 0);
      const waiting = extractWaiting(row);
      const scope = buildRowScope(row);
      const occupancy = evaluateOccupancyRate(kpiFormulas, scope);
      return {
        row,
        date: dt?.date ?? "",
        time: dt?.time ?? "",
        department: departmentMap.get(row.department_id) ?? "-",
        vacant,
        waiting,
        occupancy,
      };
    });
  }, [filteredRows, kpiFormulas, departmentMap]);

  const sortedRows = useMemo(() => {
    const compare = (a: typeof enrichedRows[number], b: typeof enrichedRows[number]) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case "date":
          av = `${a.date} ${a.time}`;
          bv = `${b.date} ${b.time}`;
          break;
        case "time":
          av = a.time;
          bv = b.time;
          break;
        case "department":
          av = a.department;
          bv = b.department;
          break;
        case "total_beds":
          av = Number(a.row.total_beds) || 0;
          bv = Number(b.row.total_beds) || 0;
          break;
        case "occupied":
          av = Number(a.row.occupied) || 0;
          bv = Number(b.row.occupied) || 0;
          break;
        case "closed":
          av = Number(a.row.closed) || 0;
          bv = Number(b.row.closed) || 0;
          break;
        case "vacant":
          av = a.vacant;
          bv = b.vacant;
          break;
        case "waiting":
          av = a.waiting;
          bv = b.waiting;
          break;
        case "occupancy":
          av = a.occupancy;
          bv = b.occupancy;
          break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    };
    return [...enrichedRows].sort(compare);
  }, [enrichedRows, sortKey, sortDir]);

  const totalRowCount = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRowCount / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedRows = useMemo(
    () => sortedRows.slice((page - 1) * pageSize, page * pageSize),
    [sortedRows, page, pageSize],
  );

  const isFiltersDefault =
    !dateRange &&
    timeFrom === "00:00" &&
    timeTo === "23:59" &&
    selectedDepartmentId === "all";

  const handleConfirmDeleteOne = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteBedSubmission(roles, deleteTarget.id);
      toast({ title: "Entry deleted", description: deleteTarget.label });
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: ["bed_submissions_dashboard"] });
    } catch (error) {
      toast({
        title: "Failed to delete entry",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteAll = async () => {
    setIsDeleting(true);
    try {
      await deleteAllBedSubmissions(roles);
      toast({ title: "All bed entries deleted" });
      setConfirmDeleteAll(false);
      void qc.invalidateQueries({ queryKey: ["bed_submissions_dashboard"] });
    } catch (error) {
      toast({
        title: "Failed to delete entries",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetFilters = () => {
    setDateRange(undefined);
    setTimeFrom("00:00");
    setTimeTo("23:59");
    setSelectedDepartmentId("all");
    setPage(1);
    void qc.invalidateQueries({ queryKey: ["bed_submissions_dashboard"] });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-50" />;
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  };

  const handleExportCsv = () => {
    const headers = [
      "Date",
      "Time",
      "Department",
      "Total Beds",
      "Occupied",
      "Closed",
      "Vacant",
      "Waiting Patients",
      "Reason for Closure",
      "Occupancy Rate (%)",
      "Status",
    ];
    const lines = [headers.map(csvEscape).join(",")];
    sortedRows.forEach((entry) => {
      const benchmark = getOccupancyBenchmark(entry.occupancy);
      lines.push(
        [
          entry.date,
          entry.time,
          entry.department,
          entry.row.total_beds,
          entry.row.occupied,
          entry.row.closed,
          entry.vacant,
          entry.waiting,
          entry.row.closure_reason || "",
          entry.occupancy.toFixed(1),
          benchmark?.label ?? "",
        ].map(csvEscape).join(","),
      );
    });
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.download = `bed-management-data-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    const headers = [
      "Date",
      "Time",
      "Department",
      "Total",
      "Occupied",
      "Closed",
      "Vacant",
      "Waiting",
      "Reason",
      "Occupancy %",
      "Status",
    ];
    const body = sortedRows.map((entry) => {
      const benchmark = getOccupancyBenchmark(entry.occupancy);
      return [
        entry.date,
        entry.time,
        entry.department,
        String(entry.row.total_beds),
        String(entry.row.occupied),
        String(entry.row.closed),
        String(entry.vacant),
        String(entry.waiting),
        entry.row.closure_reason || "",
        `${entry.occupancy.toFixed(1)}%`,
        benchmark?.label ?? "",
      ];
    });

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(14);
    doc.text("Bed Management Data", 40, 36);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Range: ${formattedRangeLabel}`, 40, 52);
    doc.text(
      `Generated: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })} (Asia/Riyadh)`,
      pageWidth - 40,
      52,
      { align: "right" },
    );

    autoTable(doc, {
      head: [headers],
      body,
      startY: 68,
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        const pageCount = doc.getNumberOfPages();
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          `Page ${doc.getCurrentPageInfo().pageNumber} of ${pageCount}`,
          pageWidth - 40,
          pageHeight - 20,
          { align: "right" },
        );
      },
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    doc.save(`bed-management-data-${stamp}.pdf`);
  };

  const formattedRangeLabel = dateRange?.from
    ? `${formatSaudiIsoDateForDisplay(calendarDateToIsoDate(dateRange.from), { year: "numeric", month: "short", day: "numeric" })}${dateRange.to ? ` - ${formatSaudiIsoDateForDisplay(calendarDateToIsoDate(dateRange.to), { year: "numeric", month: "short", day: "numeric" })}` : ""}`
    : "All dates";

  useEffect(() => {
    const channel = supabase
      .channel("data-table-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bed_submissions" }, () => {
        const timeout = setTimeout(() => {
          void qc.invalidateQueries({ queryKey: ["bed_submissions_dashboard"] });
        }, 700);
        return () => clearTimeout(timeout);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  return (
    <section className="space-y-5 sm:space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Data Table</h1>
          <p className="text-sm text-muted-foreground">
            Sortable, paginated view of all bed management entries. Unfiltered by default.
          </p>
          <Badge variant="secondary" className="mt-2 w-fit">Timezone: Asia/Riyadh</Badge>
        </div>

        <div className="grid w-full gap-2 sm:w-auto sm:min-w-[360px]">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {formattedRangeLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                className="p-3 pointer-events-auto"
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From Time</label>
              <Input type="time" value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To Time</label>
              <Input type="time" value={timeTo} onChange={(event) => setTimeTo(event.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Department</label>
              <Select value={selectedDepartmentId} onValueChange={setSelectedDepartmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departmentOptions.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {!isFiltersDefault && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                className="w-full justify-center text-destructive hover:text-destructive sm:flex-1"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset filters
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleExportCsv}
              disabled={sortedRows.length === 0}
              className="w-full justify-center sm:flex-1"
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleExportPdf}
              disabled={sortedRows.length === 0}
              className="w-full justify-center sm:flex-1"
            >
              <FileText className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
            {canDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDeleteAll(true)}
                disabled={rows.length === 0}
                className="w-full justify-center sm:flex-1"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete all
              </Button>
            )}
          </div>
        </div>
      </header>

      <Card className="hospital-glass">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>All Entered Records</CardTitle>
          <span className="text-xs text-muted-foreground">
            {totalRowCount} {totalRowCount === 1 ? "record" : "records"}
          </span>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("date")}>
                    Date {renderSortIcon("date")}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("time")}>
                    Time {renderSortIcon("time")}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("department")}>
                    Department {renderSortIcon("department")}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("total_beds")}>
                    Total Beds {renderSortIcon("total_beds")}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("occupied")}>
                    Occupied {renderSortIcon("occupied")}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("closed")}>
                    Closed {renderSortIcon("closed")}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("vacant")}>
                    Vacant {renderSortIcon("vacant")}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("waiting")}>
                    Waiting {renderSortIcon("waiting")}
                  </TableHead>
                  <TableHead>Reason for Closure</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort("occupancy")}>
                    Occupancy {renderSortIcon("occupancy")}
                  </TableHead>
                  <TableHead>Status</TableHead>
                  {canDelete && <TableHead className="w-[60px] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canDelete ? 12 : 11} className="py-6 text-center text-muted-foreground">
                      No entries found for the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRows.map((entry) => {
                    const benchmark = getOccupancyBenchmark(entry.occupancy);
                    return (
                      <TableRow key={entry.row.id}>
                        <TableCell>{entry.date || "-"}</TableCell>
                        <TableCell>{entry.time || "-"}</TableCell>
                        <TableCell>{entry.department}</TableCell>
                        <TableCell className="text-right font-medium">{entry.row.total_beds}</TableCell>
                        <TableCell className="text-right">{entry.row.occupied}</TableCell>
                        <TableCell className="text-right">{entry.row.closed}</TableCell>
                        <TableCell className="text-right">{entry.vacant}</TableCell>
                        <TableCell className="text-right">{entry.waiting}</TableCell>
                        <TableCell>{entry.row.closure_reason || "-"}</TableCell>
                        <TableCell className="text-right" style={{ color: benchmark?.color }}>
                          {entry.occupancy.toFixed(1)}%
                        </TableCell>
                        <TableCell><StatusBadge level={benchmark} /></TableCell>
                        {canDelete && (
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() =>
                                setDeleteTarget({
                                  id: entry.row.id,
                                  label: `${entry.department} • ${entry.date} ${entry.time}`,
                                })
                              }
                              aria-label="Delete entry"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page:</span>
              <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
                <SelectTrigger className="h-8 w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={page <= 1}>
                « First
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages}>
                Next
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
                Last »
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bed entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.label}
              <br />
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDeleteOne();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteAll} onOpenChange={setConfirmDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ALL bed entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove every bed submission from the database
              ({rows.length} {rows.length === 1 ? "record" : "records"}). This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDeleteAll();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default DataTablePage;