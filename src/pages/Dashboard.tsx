import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarIcon, RotateCcw, LayoutGrid, Table as TableIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  calendarDateToIsoDate,
  formatSaudiIsoDateForDisplay,
  getSaudiIsoDate,
  getSaudiWeekdayShortFromIsoDate,
  isoDateToCalendarDate,
} from "@/lib/date-time";
import {
  aggregateSubmissionSums,
  fetchDashboardSubmissions,
  fetchDepartments,
  fetchDepartmentTotalBeds,
  fetchKpiFormulas,
  fetchOccupancyBenchmarkSettings,
} from "@/lib/supabase-api";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";
import { StatusBadge } from "@/components/status-badge";
import { getStatusIconComponent, getDefaultIconForLabel } from "@/lib/status-icons";
import {
  buildAggregateScope,
  buildRowScope,
  evaluateNamedFormula,
  evaluateOccupancyRate,
} from "@/lib/formula-registry";

const SAUDI_HOLIDAYS: Record<string, string> = {
  "2025-02-22": "Founding Day",
  "2025-09-23": "National Day",
  "2026-02-22": "Founding Day",
  "2026-09-23": "National Day",
  "2027-02-22": "Founding Day",
  "2027-09-23": "National Day",
};

const DashboardPage = () => {
  const qc = useQueryClient();
  const today = useMemo(() => isoDateToCalendarDate(getSaudiIsoDate()), []);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: today, to: today });
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("all");
  const rangeStart = dateRange?.from ?? today;
  const rangeEnd = dateRange?.to ?? dateRange?.from ?? today;

  const rangeStartIso = useMemo(() => calendarDateToIsoDate(rangeStart), [rangeStart]);
  const rangeEndIso = useMemo(() => calendarDateToIsoDate(rangeEnd), [rangeEnd]);

  const { data: rows = [] } = useQuery({
    queryKey: ["bed_submissions_dashboard"],
    queryFn: fetchDashboardSubmissions,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
  });

  const { data: occupancyBenchmark } = useQuery({
    queryKey: ["app_settings", "occupancy_benchmark"],
    queryFn: fetchOccupancyBenchmarkSettings,
  });

  const { data: kpiFormulas = [] } = useQuery({
    queryKey: ["kpi_formulas"],
    queryFn: fetchKpiFormulas,
  });

  const { data: departmentTotalBeds = {} } = useQuery({
    queryKey: ["app_settings", "department_total_beds"],
    queryFn: fetchDepartmentTotalBeds,
  });

  const extractUserInputDateTime = (row: (typeof rows)[number]) => {
    const customFields = (row.custom_fields as Record<string, unknown>) ?? {};

    for (const value of Object.values(customFields)) {
      if (typeof value !== "string") continue;
      const normalized = value.trim();
      const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
      if (match) {
        return { date: match[1], time: match[2] };
      }
    }

    return null;
  };

  const dateFilteredRows = useMemo(() => {
    const dateFrom = rangeStartIso <= rangeEndIso ? rangeStartIso : rangeEndIso;
    const dateTo = rangeStartIso <= rangeEndIso ? rangeEndIso : rangeStartIso;
    return rows.filter((row) => {
      const userDateTime = extractUserInputDateTime(row);
      if (!userDateTime) return false;
      return userDateTime.date >= dateFrom && userDateTime.date <= dateTo;
    });
  }, [rows, rangeStartIso, rangeEndIso]);

  const availableTimes = useMemo(() => {
    const set = new Set<string>();
    dateFilteredRows.forEach((row) => {
      const dt = extractUserInputDateTime(row);
      if (dt?.time) set.add(dt.time);
    });
    return Array.from(set).sort();
  }, [dateFilteredRows]);

  const dateTimeFilteredRows = useMemo(() => {
    if (!selectedTime) return dateFilteredRows;
    return dateFilteredRows.filter((row) => {
      const userDateTime = extractUserInputDateTime(row);
      return userDateTime?.time === selectedTime;
    });
  }, [dateFilteredRows, selectedTime]);

  // Auto-select a valid time when the current selection isn't available
  useEffect(() => {
    if (availableTimes.length === 0) {
      if (selectedTime !== "") setSelectedTime("");
      return;
    }
    if (!availableTimes.includes(selectedTime)) {
      setSelectedTime(availableTimes[availableTimes.length - 1]);
    }
  }, [availableTimes, selectedTime]);

  const departmentOptions = useMemo(() => {
    const availableDepartmentIds = new Set(
      dateTimeFilteredRows.map((row) => row.department_id),
    );

    return departments.filter((department) => availableDepartmentIds.has(department.id));
  }, [dateTimeFilteredRows, departments]);

  useEffect(() => {
    if (selectedDepartmentId !== "all" && !departmentOptions.some((department) => department.id === selectedDepartmentId)) {
      setSelectedDepartmentId("all");
    }
  }, [departmentOptions, selectedDepartmentId]);

  const filteredRows = useMemo(
    () =>
      dateTimeFilteredRows.filter((row) => {
        if (selectedDepartmentId !== "all" && row.department_id !== selectedDepartmentId) return false;
        return true;
      }),
    [dateTimeFilteredRows, selectedDepartmentId],
  );

  const availableDateSet = useMemo(() => {
    const dates = new Set<string>();
    rows.forEach((row) => {
      const value = extractUserInputDateTime(row)?.date;
      if (value) dates.add(value);
    });
    return dates;
  }, [rows]);

  const isSaudiFriday = (value: Date) => {
    const iso = calendarDateToIsoDate(value);
    return getSaudiWeekdayShortFromIsoDate(iso) === "Fri";
  };

  const isSaudiSaturday = (value: Date) => {
    const iso = calendarDateToIsoDate(value);
    return getSaudiWeekdayShortFromIsoDate(iso) === "Sat";
  };

  const hasSaudiHoliday = (value: Date) => {
    const iso = calendarDateToIsoDate(value);
    return Boolean(SAUDI_HOLIDAYS[iso]);
  };

  const isDateDisabled = (value: Date) => {
    if (availableDateSet.size === 0) return true;
    return !availableDateSet.has(calendarDateToIsoDate(value));
  };

  const formattedRangeLabel = `${formatSaudiIsoDateForDisplay(rangeStartIso, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })} - ${formatSaudiIsoDateForDisplay(rangeEndIso, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;

  const sums = aggregateSubmissionSums(filteredRows);
  const waitingPatients = filteredRows.reduce((total, row) => {
    const customFields = (row.custom_fields as Record<string, unknown>) ?? {};

    const directValue = customFields.waiting_patients ?? customFields.waitingPatients;
    if (typeof directValue === "number") return total + directValue;
    if (typeof directValue === "string") return total + (Number(directValue) || 0);

    const discoveredValue = Object.entries(customFields).find(([key]) =>
      key.toLowerCase().includes("waiting") && key.toLowerCase().includes("patient"),
    )?.[1];

    if (typeof discoveredValue === "number") return total + discoveredValue;
    if (typeof discoveredValue === "string") return total + (Number(discoveredValue) || 0);

    return total;
  }, 0);

  // Assigned total beds come from admin-managed Categories settings, not from
  // submissions. When filtered to a single department, only that department's
  // assigned count contributes; "All departments" sums every active assignment.
  const assignedTotalBeds = useMemo(() => {
    if (selectedDepartmentId !== "all") {
      return Number(departmentTotalBeds[selectedDepartmentId] ?? 0) || 0;
    }
    return departments.reduce(
      (sum, dept) => sum + (Number(departmentTotalBeds[dept.id] ?? 0) || 0),
      0,
    );
  }, [departmentTotalBeds, departments, selectedDepartmentId]);

  const aggregateScope = useMemo(
    () => ({ ...buildAggregateScope(filteredRows), total_beds: assignedTotalBeds }),
    [filteredRows, assignedTotalBeds],
  );
  const occupancyRate = useMemo(
    () => evaluateOccupancyRate(kpiFormulas, aggregateScope),
    [kpiFormulas, aggregateScope],
  );
  // Resolve KPI Builder formulas (when defined) for the headline cards.
  // These fall back to the raw aggregated sums when no matching formula exists.
  const kpiCardValues = useMemo(
    () => ({
      total_beds: assignedTotalBeds,
      occupied: evaluateNamedFormula(kpiFormulas, "Occupied", aggregateScope, sums.occupied),
      closed: evaluateNamedFormula(kpiFormulas, "Closed", aggregateScope, sums.closed),
      vacant: evaluateNamedFormula(kpiFormulas, "Vacant", aggregateScope, sums.vacant),
      waiting_patients: evaluateNamedFormula(kpiFormulas, "Waiting Patients", aggregateScope, waitingPatients),
    }),
    [kpiFormulas, aggregateScope, assignedTotalBeds, sums.occupied, sums.closed, sums.vacant, waitingPatients],
  );
  const benchmarkLevels = occupancyBenchmark?.levels ?? [
    {
      key: "low",
      label: "Low",
      threshold: "< 60%",
      minPercent: null,
      maxPercent: 60,
      minInclusive: false,
      maxInclusive: false,
      color: "#16a34a",
      icon: "thumbs-up",
    },
    {
      key: "optimal",
      label: "Optimal",
      threshold: "60% – 84%",
      minPercent: 60,
      maxPercent: 84,
      minInclusive: true,
      maxInclusive: true,
      color: "#16a34a",
      icon: "check",
    },
    {
      key: "watch",
      label: "Watch",
      threshold: "85% – 89%",
      minPercent: 85,
      maxPercent: 89,
      minInclusive: true,
      maxInclusive: true,
      color: "#f59e0b",
      icon: "eye",
    },
    {
      key: "high",
      label: "High",
      threshold: "≥ 90%",
      minPercent: 90,
      maxPercent: null,
      minInclusive: true,
      maxInclusive: false,
      color: "#dc2626",
      icon: "alert-triangle",
    },
  ];

  const getOccupancyBenchmark = (value: number) =>
    benchmarkLevels.find((level) => {
      const minPass = level.minPercent === null ? true : level.minInclusive ? value >= level.minPercent : value > level.minPercent;
      const maxPass = level.maxPercent === null ? true : level.maxInclusive ? value <= level.maxPercent : value < level.maxPercent;
      return minPass && maxPass;
    }) ?? benchmarkLevels[benchmarkLevels.length - 1];

  const occupancyBenchmarkMatch = getOccupancyBenchmark(occupancyRate);

  const [departmentView, setDepartmentView] = useState<"cards" | "table">("cards");

  const departmentStatusCards = useMemo(() => {
    const latestByDept = new Map<
      string,
      { row: (typeof filteredRows)[number]; date: string; time: string }
    >();

    for (const row of filteredRows) {
      const dt = extractUserInputDateTime(row);
      if (!dt) continue;
      const key = row.department_id;
      if (!key) continue;
      const existing = latestByDept.get(key);
      if (!existing || `${dt.date}T${dt.time}` > `${existing.date}T${existing.time}`) {
        latestByDept.set(key, { row, date: dt.date, time: dt.time });
      }
    }

    return Array.from(latestByDept.entries())
      .map(([deptId, entry]) => {
        const department = departments.find((d) => d.id === deptId);
        // Per-department total beds come from the admin-managed assignment in
        // Categories, not from the submission row. Submission row is still
        // used for occupied/closed/vacant + occupancy rate calculation.
        const assignedTotal = Number(departmentTotalBeds[deptId] ?? 0) || 0;
        const scope = { ...buildRowScope(entry.row), total_beds: assignedTotal };
        const occupiedRaw = Number(entry.row.occupied) || 0;
        const closedRaw = Number(entry.row.closed) || 0;
        const vacantFallback = Math.max(assignedTotal - occupiedRaw - closedRaw, 0);
        const occupied = evaluateNamedFormula(kpiFormulas, "Occupied", scope, occupiedRaw);
        const closed = evaluateNamedFormula(kpiFormulas, "Closed", scope, closedRaw);
        const vacant = evaluateNamedFormula(kpiFormulas, "Vacant", scope, vacantFallback);
        const rate = evaluateOccupancyRate(kpiFormulas, scope);
        const benchmark = getOccupancyBenchmark(rate);
        return {
          id: deptId,
          name: department?.name ?? "Unknown department",
          total: assignedTotal,
          occupied: Math.round(occupied),
          vacant: Math.round(vacant),
          closed: Math.round(closed),
          rate,
          benchmark,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredRows, departments, departmentTotalBeds, kpiFormulas, benchmarkLevels]);

  const isFiltersDefault =
    calendarDateToIsoDate(rangeStart) === calendarDateToIsoDate(today) &&
    calendarDateToIsoDate(rangeEnd) === calendarDateToIsoDate(today) &&
    selectedDepartmentId === "all";

  const handleResetFilters = () => {
    const freshToday = isoDateToCalendarDate(getSaudiIsoDate());
    setDateRange({ from: freshToday, to: freshToday });
    setSelectedDepartmentId("all");
    void qc.invalidateQueries({ queryKey: ["bed_submissions_dashboard"] });
  };

  const renderStatusBadge = (level: { key: string; label: string; color: string; icon?: string }) => (
    <StatusBadge level={level} />
  );

  useEffect(() => {
    const debouncedRefresh = () => {
      const timeout = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["bed_submissions_range"] });
      }, 700);

      return () => clearTimeout(timeout);
    };

    const channel = supabase
      .channel("bed-submissions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bed_submissions" }, () => {
        debouncedRefresh();
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
          <h1 className="text-2xl font-bold sm:text-3xl">Live Hospital Dashboard</h1>
          <p className="text-sm text-muted-foreground">Realtime, free-tier-safe metrics with manual refresh support.</p>
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
                today={today}
                numberOfMonths={2}
                className="p-3 pointer-events-auto"
                disabled={isDateDisabled}
                modifiers={{
                  saudiFriday: isSaudiFriday,
                  saudiSaturday: isSaudiSaturday,
                  saHoliday: hasSaudiHoliday,
                }}
                modifiersClassNames={{
                  saudiFriday: "text-primary",
                  saudiSaturday: "text-muted-foreground font-semibold",
                  saHoliday: "relative after:absolute after:bottom-1 after:left-1/2 after:h-1.5 after:w-1.5 after:-translate-x-1/2 after:rounded-full after:bg-primary",
                }}
                classNames={{
                  day_selected:
                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                  day_today:
                    "bg-transparent text-foreground ring-2 ring-primary ring-offset-2 ring-offset-background hover:bg-accent",
                  day_disabled: "text-muted-foreground opacity-40",
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Time</label>
            <Select
              value={selectedTime || undefined}
              onValueChange={setSelectedTime}
              disabled={availableTimes.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select time" />
              </SelectTrigger>
              <SelectContent>
                {availableTimes.map((time) => (
                  <SelectItem key={time} value={time}>
                    {time}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableTimes.length === 0 && (
              <p className="text-xs text-muted-foreground">No bed entry times available for the selected date range.</p>
            )}
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

          {!isFiltersDefault && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              className="w-full justify-center text-destructive hover:text-destructive"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset filters
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-3 2xl:grid-cols-6">
        {(() => {
          const hasEntries =
            filteredRows.length > 0 &&
            (sums.total_beds > 0 ||
              sums.occupied > 0 ||
              sums.closed > 0 ||
              sums.vacant > 0 ||
              waitingPatients > 0);
          return [
          { name: "Total Beds", value: Math.round(kpiCardValues.total_beds) },
          { name: "Occupied", value: Math.round(kpiCardValues.occupied) },
          { name: "Closed", value: Math.round(kpiCardValues.closed) },
          { name: "Vacant", value: Math.round(kpiCardValues.vacant) },
          { name: "Waiting Patients", value: Math.round(kpiCardValues.waiting_patients) },
            {
              name: "Occupancy Rate",
              value: `${occupancyRate.toFixed(1)}%`,
              accentColor: occupancyBenchmarkMatch?.color,
              subtitle: occupancyBenchmarkMatch?.label,
            },
        ].map((metric, index) => (
          <motion.div
            key={metric.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.25 }}
            className="h-full"
          >
            <Card className="hospital-glass h-full">
              {!hasEntries ? (
                <>
                  <CardHeader className="p-3 pb-1 sm:p-6 sm:pb-2">
                    <CardTitle className="text-xs text-muted-foreground sm:text-sm">{metric.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
                    <p className="text-xs italic text-muted-foreground sm:text-sm">No entries found</p>
                  </CardContent>
                </>
              ) : metric.name === "Occupancy Rate" ? (
                (() => {
                  const level = occupancyBenchmarkMatch;
                  const iconKey = level?.icon ?? (level ? getDefaultIconForLabel(level.label, level.key) : undefined);
                  const StatusIcon = getStatusIconComponent(iconKey);
                  const accent = metric.accentColor ?? "hsl(var(--primary))";
                  const clamped = Math.max(0, Math.min(100, occupancyRate));
                  const progressId = `occupancy-progress-${index}`;
                  return (
                    <div
                      className="group relative h-full w-full overflow-hidden rounded-lg p-3 sm:p-5"
                    >
                      <style>{`
                        @keyframes occupancy-shimmer-${index} {
                          0% { transform: translateX(-100%); }
                          100% { transform: translateX(200%); }
                        }
                        .${progressId}-track {
                          position: relative;
                          width: 100%;
                          height: 10px;
                          border-radius: 9999px;
                          background-color: color-mix(in srgb, ${accent} 12%, hsl(var(--muted)));
                          overflow: hidden;
                          box-shadow: inset 0 1px 2px color-mix(in srgb, ${accent} 18%, transparent);
                        }
                        .${progressId}-fill {
                          position: relative;
                          height: 100%;
                          border-radius: 9999px;
                          background-image: linear-gradient(90deg,
                            color-mix(in srgb, ${accent} 55%, white) 0%,
                            ${accent} 100%);
                          box-shadow: 0 0 12px color-mix(in srgb, ${accent} 40%, transparent);
                          transition: width 0.5s ease;
                          overflow: hidden;
                        }
                        .${progressId}-fill::after {
                          content: "";
                          position: absolute;
                          inset: 0;
                          background-image: linear-gradient(90deg,
                            transparent 0%,
                            rgba(255,255,255,0.45) 50%,
                            transparent 100%);
                          transform: translateX(-100%);
                          animation: occupancy-shimmer-${index} 2s linear infinite;
                        }
                      `}</style>

                      {StatusIcon ? (
                        <StatusIcon
                          size={64}
                          aria-hidden
                          className="pointer-events-none absolute right-2 top-2 h-10 w-10 transition-all duration-300 group-hover:rotate-[-4deg] sm:right-3 sm:top-3 sm:h-16 sm:w-16"
                          style={{
                            color: accent,
                            opacity: 0.13,
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as SVGSVGElement).style.opacity = "0.22";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as SVGSVGElement).style.opacity = "0.13";
                          }}
                        />
                      ) : null}

                      <div className="relative flex h-full min-w-0 flex-col gap-2 pr-12 sm:gap-3 sm:pr-20">
                        <p className="text-xs text-muted-foreground sm:text-sm">{metric.name}</p>
                        <p
                          className="text-2xl font-bold leading-tight sm:text-4xl"
                          style={{ color: accent }}
                        >
                          {metric.value}
                        </p>
                        <div className="w-full">
                          <div className={`${progressId}-track`}>
                            <div
                              className={`${progressId}-fill`}
                              style={{ width: `${clamped}%` }}
                            />
                          </div>
                        </div>
                        {metric.subtitle ? (
                          <div
                            className="flex items-center gap-1.5 text-xs font-medium"
                            style={{ color: accent }}
                          >
                            {StatusIcon ? <StatusIcon size={14} aria-hidden /> : null}
                            <span>{metric.subtitle}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <>
                  <CardHeader className="p-3 pb-1 sm:p-6 sm:pb-2">
                    <CardTitle className="text-xs text-muted-foreground sm:text-sm">{metric.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
                    <p className="text-xl font-bold sm:text-3xl">{metric.value}</p>
                  </CardContent>
                </>
              )}
            </Card>
          </motion.div>
        ));
        })()}
      </div>

      <Card className="hospital-glass">
        <CardHeader className="flex flex-col gap-3 space-y-0 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <CardTitle className="text-base sm:text-lg">
              {departmentView === "cards" ? "Department Status" : "Department Occupancy"}
            </CardTitle>
            <span className="inline-flex items-center rounded-full bg-teal-100 px-2.5 py-0.5 text-[11px] font-semibold text-teal-700 sm:px-3 sm:py-1 sm:text-xs">
              {departmentStatusCards.length} Active {departmentStatusCards.length === 1 ? "Department" : "Departments"}
            </span>
          </div>
          <div className="inline-flex w-full items-center rounded-md border bg-muted p-1 sm:w-auto">
            <button
              type="button"
              onClick={() => setDepartmentView("cards")}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none ${
                departmentView === "cards"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={departmentView === "cards"}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Cards
            </button>
            <button
              type="button"
              onClick={() => setDepartmentView("table")}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none ${
                departmentView === "table"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={departmentView === "table"}
            >
              <TableIcon className="h-3.5 w-3.5" />
              Table
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          {departmentView === "cards" ? (
            departmentStatusCards.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No department entries found for the selected filters.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {departmentStatusCards.map((dept) => {
                  const clamped = Math.max(0, Math.min(100, dept.rate));
                  return (
                    <div
                      key={dept.id}
                      className="rounded-xl border bg-card p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold text-foreground sm:text-base">
                          {dept.name}
                        </h3>
                        <StatusBadge level={dept.benchmark} size="sm" />
                      </div>

                      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                        <div>
                          <p className="text-xl font-bold text-foreground sm:text-2xl">
                            {dept.total}
                          </p>
                          <p className="text-[11px] text-muted-foreground">Total</p>
                        </div>
                        <div>
                          <p className="text-xl font-bold sm:text-2xl" style={{ color: "#b91c1c" }}>
                            {dept.occupied}
                          </p>
                          <p className="text-[11px] text-muted-foreground">Occupied</p>
                        </div>
                        <div>
                          <p className="text-xl font-bold sm:text-2xl" style={{ color: "#16a34a" }}>
                            {dept.vacant}
                          </p>
                          <p className="text-[11px] text-muted-foreground">Vacant</p>
                        </div>
                        <div>
                          <p className="text-xl font-bold text-muted-foreground sm:text-2xl">
                            {dept.closed}
                          </p>
                          <p className="text-[11px] text-muted-foreground">Closed</p>
                        </div>
                      </div>

                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${clamped}%`,
                            backgroundColor: dept.benchmark?.color ?? "#b91c1c",
                          }}
                        />
                      </div>

                      <p className="mt-2 text-right text-xs text-muted-foreground">
                        {dept.rate.toFixed(0)}% occupied
                      </p>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Occupied</TableHead>
                  <TableHead className="text-right">Vacant</TableHead>
                  <TableHead>Occupancy</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departmentStatusCards.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      No entries found for the selected date/time filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {departmentStatusCards.map((dept) => {
                      const clamped = Math.min(Math.max(dept.rate, 0), 100);
                      const barColor = dept.benchmark?.color ?? "#b91c1c";
                      return (
                        <TableRow key={dept.id}>
                          <TableCell className="font-semibold">{dept.name}</TableCell>
                          <TableCell className="text-right font-medium">{dept.total}</TableCell>
                          <TableCell className="text-right" style={{ color: "#b91c1c" }}>{dept.occupied}</TableCell>
                          <TableCell className="text-right" style={{ color: "#16a34a" }}>{dept.vacant}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 min-w-[160px]">
                              <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${clamped}%`, backgroundColor: barColor }}
                                />
                              </div>
                              <span className="text-sm font-semibold tabular-nums" style={{ color: barColor }}>
                                {dept.rate.toFixed(1)}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>{renderStatusBadge(dept.benchmark)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </>
                )}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};

export default DashboardPage;
