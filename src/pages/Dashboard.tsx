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
  fetchBedTypes,
  fetchDashboardSubmissions,
  fetchDepartments,
  fetchKpiFormulas,
  fetchOccupancyBenchmarkSettings,
} from "@/lib/supabase-api";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";
import { StatusBadge } from "@/components/status-badge";
import { getStatusIconComponent, getDefaultIconForLabel } from "@/lib/status-icons";
import { buildAggregateScope, buildRowScope, evaluateOccupancyRate } from "@/lib/formula-registry";

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
  const [timeFrom, setTimeFrom] = useState("00:00");
  const [timeTo, setTimeTo] = useState("23:59");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("all");
  const [selectedBedTypeId, setSelectedBedTypeId] = useState<string>("all");
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

  const { data: bedTypes = [] } = useQuery({
    queryKey: ["bed_types"],
    queryFn: fetchBedTypes,
  });

  const { data: occupancyBenchmark } = useQuery({
    queryKey: ["app_settings", "occupancy_benchmark"],
    queryFn: fetchOccupancyBenchmarkSettings,
  });

  const { data: kpiFormulas = [] } = useQuery({
    queryKey: ["kpi_formulas"],
    queryFn: fetchKpiFormulas,
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

  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return (Number.isNaN(hours) ? 0 : hours) * 60 + (Number.isNaN(minutes) ? 0 : minutes);
  };

  const dateTimeFilteredRows = useMemo(() => {
    const fromMinutes = toMinutes(timeFrom);
    const toMinutesValue = toMinutes(timeTo);
    const wrapsMidnight = fromMinutes > toMinutesValue;
    const dateFrom = rangeStartIso <= rangeEndIso ? rangeStartIso : rangeEndIso;
    const dateTo = rangeStartIso <= rangeEndIso ? rangeEndIso : rangeStartIso;

    return rows.filter((row) => {
      const userDateTime = extractUserInputDateTime(row);
      if (!userDateTime) return false;

      if (userDateTime.date < dateFrom || userDateTime.date > dateTo) return false;

      const valueMinutes = toMinutes(userDateTime.time);

      if (wrapsMidnight) {
        return valueMinutes >= fromMinutes || valueMinutes <= toMinutesValue;
      }

      return valueMinutes >= fromMinutes && valueMinutes <= toMinutesValue;
    });
  }, [rows, timeFrom, timeTo, rangeStartIso, rangeEndIso]);

  const departmentOptions = useMemo(() => {
    const availableDepartmentIds = new Set(
      dateTimeFilteredRows
        .filter((row) => selectedBedTypeId === "all" || row.bed_type_id === selectedBedTypeId)
        .map((row) => row.department_id),
    );

    return departments.filter((department) => availableDepartmentIds.has(department.id));
  }, [dateTimeFilteredRows, departments, selectedBedTypeId]);

  const bedTypeOptions = useMemo(() => {
    const availableBedTypeIds = new Set(
      dateTimeFilteredRows
        .filter((row) => selectedDepartmentId === "all" || row.department_id === selectedDepartmentId)
        .map((row) => row.bed_type_id)
        .filter((id): id is string => Boolean(id)),
    );

    return bedTypes.filter((bedType) => availableBedTypeIds.has(bedType.id));
  }, [dateTimeFilteredRows, bedTypes, selectedDepartmentId]);

  useEffect(() => {
    if (selectedDepartmentId !== "all" && !departmentOptions.some((department) => department.id === selectedDepartmentId)) {
      setSelectedDepartmentId("all");
    }
  }, [departmentOptions, selectedDepartmentId]);

  useEffect(() => {
    if (selectedBedTypeId !== "all" && !bedTypeOptions.some((bedType) => bedType.id === selectedBedTypeId)) {
      setSelectedBedTypeId("all");
    }
  }, [bedTypeOptions, selectedBedTypeId]);

  const filteredRows = useMemo(
    () =>
      dateTimeFilteredRows.filter((row) => {
        if (selectedDepartmentId !== "all" && row.department_id !== selectedDepartmentId) return false;
        if (selectedBedTypeId !== "all" && row.bed_type_id !== selectedBedTypeId) return false;
        return true;
      }),
    [dateTimeFilteredRows, selectedDepartmentId, selectedBedTypeId],
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
  const aggregateScope = useMemo(() => buildAggregateScope(filteredRows), [filteredRows]);
  const occupancyRate = useMemo(
    () => evaluateOccupancyRate(kpiFormulas, aggregateScope),
    [kpiFormulas, aggregateScope],
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
        const total = Number(entry.row.total_beds) || 0;
        const occupied = Number(entry.row.occupied) || 0;
        const closed = Number(entry.row.closed) || 0;
        const vacant = Math.max(total - occupied - closed, 0);
        const scope = buildRowScope(entry.row);
        const rate = evaluateOccupancyRate(kpiFormulas, scope);
        const benchmark = getOccupancyBenchmark(rate);
        return {
          id: deptId,
          name: department?.name ?? "Unknown department",
          total,
          occupied,
          vacant,
          closed,
          rate,
          benchmark,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredRows, departments, kpiFormulas, benchmarkLevels]);

  const isFiltersDefault =
    calendarDateToIsoDate(rangeStart) === calendarDateToIsoDate(today) &&
    calendarDateToIsoDate(rangeEnd) === calendarDateToIsoDate(today) &&
    timeFrom === "00:00" &&
    timeTo === "23:59" &&
    selectedDepartmentId === "all" &&
    selectedBedTypeId === "all";

  const handleResetFilters = () => {
    const freshToday = isoDateToCalendarDate(getSaudiIsoDate());
    setDateRange({ from: freshToday, to: freshToday });
    setTimeFrom("00:00");
    setTimeTo("23:59");
    setSelectedDepartmentId("all");
    setSelectedBedTypeId("all");
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

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Bed Type</label>
              <Select value={selectedBedTypeId} onValueChange={setSelectedBedTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="All bed types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All bed types</SelectItem>
                  {bedTypeOptions.map((bedType) => (
                    <SelectItem key={bedType.id} value={bedType.id}>
                      {bedType.name}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {[
          { name: "Total Beds", value: sums.total_beds },
          { name: "Occupied", value: sums.occupied },
          { name: "Closed", value: sums.closed },
          { name: "Vacant", value: sums.vacant },
          { name: "Waiting Patients", value: waitingPatients },
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
              {metric.name === "Occupancy Rate" ? (
                (() => {
                  const level = occupancyBenchmarkMatch;
                  const iconKey = level?.icon ?? (level ? getDefaultIconForLabel(level.label, level.key) : undefined);
                  const StatusIcon = getStatusIconComponent(iconKey);
                  const accent = metric.accentColor ?? "hsl(var(--primary))";
                  const clamped = Math.max(0, Math.min(100, occupancyRate));
                  const progressId = `occupancy-progress-${index}`;
                  return (
                    <div
                      className="group relative h-full w-full overflow-hidden rounded-lg"
                      style={{ padding: "20px 24px" }}
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
                          className="pointer-events-none absolute right-3 top-3 transition-all duration-300 group-hover:rotate-[-4deg]"
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

                      <div className="relative flex h-full min-w-0 flex-col gap-3 pr-16 sm:pr-20">
                        <p className="text-sm text-muted-foreground">{metric.name}</p>
                        <p
                          className="text-3xl font-bold leading-tight sm:text-4xl"
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
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">{metric.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold sm:text-3xl">{metric.value}</p>
                  </CardContent>
                </>
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="hospital-glass">
        <CardHeader>
          <CardTitle>Department Status</CardTitle>
        </CardHeader>
        <CardContent>
          {departmentStatusCards.length === 0 ? (
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
          )}
        </CardContent>
      </Card>

      <Card className="hospital-glass">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Department Occupancy</CardTitle>
          <span className="inline-flex items-center rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700">
            {departmentStatusCards.length} Active {departmentStatusCards.length === 1 ? "Department" : "Departments"}
          </span>
        </CardHeader>
        <CardContent>
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
                    <TableRow className="bg-muted/30">
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-semibold">{sums.total_beds}</TableCell>
                      <TableCell className="text-right font-semibold" style={{ color: "#b91c1c" }}>{sums.occupied}</TableCell>
                      <TableCell className="text-right font-semibold" style={{ color: "#16a34a" }}>{sums.vacant}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[160px]">
                          <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(Math.max(occupancyRate, 0), 100)}%`,
                                backgroundColor: occupancyBenchmarkMatch.color,
                              }}
                            />
                          </div>
                          <span className="text-sm font-semibold tabular-nums" style={{ color: occupancyBenchmarkMatch.color }}>
                            {occupancyRate.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{renderStatusBadge(occupancyBenchmarkMatch)}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};

export default DashboardPage;
