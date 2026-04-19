import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchDashboardSubmissions, aggregateSubmissionSums } from "@/lib/supabase-api";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";

const SAUDI_TIMEZONE = "Asia/Riyadh";

const pad2 = (value: number) => String(value).padStart(2, "0");

const getSaudiTodayIso = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SAUDI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not derive Saudi Arabia date");
  }

  return `${year}-${month}-${day}`;
};

const isoToCalendarDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
};

const calendarDateToIso = (value: Date) => {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
};

const HIJRI_DAY_FORMATTER = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
  timeZone: SAUDI_TIMEZONE,
  day: "numeric",
});

const HIJRI_DATE_FORMATTER = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
  timeZone: SAUDI_TIMEZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
});

const GREGORIAN_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SAUDI_TIMEZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
});

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
  const today = useMemo(() => isoToCalendarDate(getSaudiTodayIso()), []);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: today, to: today });
  const [timeFrom, setTimeFrom] = useState("00:00");
  const [timeTo, setTimeTo] = useState("23:59");
  const [showHijri, setShowHijri] = useState(false);
  const rangeStart = dateRange?.from ?? today;
  const rangeEnd = dateRange?.to ?? dateRange?.from ?? today;

  const rangeStartIso = useMemo(() => calendarDateToIso(rangeStart), [rangeStart]);
  const rangeEndIso = useMemo(() => calendarDateToIso(rangeEnd), [rangeEnd]);

  const { data: rows = [] } = useQuery({
    queryKey: ["bed_submissions_dashboard"],
    queryFn: fetchDashboardSubmissions,
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

  const filteredRows = useMemo(() => {
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

  const availableDateSet = useMemo(() => {
    const dates = new Set<string>();
    rows.forEach((row) => {
      const value = extractUserInputDateTime(row)?.date;
      if (value) dates.add(value);
    });
    return dates;
  }, [rows]);

  const isSaudiFriday = (value: Date) => {
    const iso = calendarDateToIso(value);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: SAUDI_TIMEZONE,
      weekday: "short",
    }).format(new Date(`${iso}T12:00:00+03:00`));
    return weekday === "Fri";
  };

  const isSaudiSaturday = (value: Date) => {
    const iso = calendarDateToIso(value);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: SAUDI_TIMEZONE,
      weekday: "short",
    }).format(new Date(`${iso}T12:00:00+03:00`));
    return weekday === "Sat";
  };

  const hasSaudiHoliday = (value: Date) => {
    const iso = calendarDateToIso(value);
    return Boolean(SAUDI_HOLIDAYS[iso]);
  };

  const isDateDisabled = (value: Date) => {
    if (availableDateSet.size === 0) return true;
    return !availableDateSet.has(calendarDateToIso(value));
  };

  const formattedRangeLabel = showHijri
    ? `${HIJRI_DATE_FORMATTER.format(rangeStart)} - ${HIJRI_DATE_FORMATTER.format(rangeEnd)}`
    : `${GREGORIAN_DATE_FORMATTER.format(rangeStart)} - ${GREGORIAN_DATE_FORMATTER.format(rangeEnd)}`;

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
  const occupancyRate = sums.total_beds > 0 ? (sums.occupied / sums.total_beds) * 100 : 0;

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
                components={showHijri ? { DayContent: ({ date }) => <span>{HIJRI_DAY_FORMATTER.format(date)}</span> } : undefined}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Hijri view</span>
            <Switch checked={showHijri} onCheckedChange={setShowHijri} aria-label="Toggle Hijri calendar view" />
          </div>

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
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {[
          { name: "Total Beds", value: sums.total_beds },
          { name: "Occupied", value: sums.occupied },
          { name: "Closed", value: sums.closed },
          { name: "Vacant", value: sums.vacant },
          { name: "Waiting Patients", value: waitingPatients },
          { name: "Occupancy Rate", value: `${occupancyRate.toFixed(1)}%` },
        ].map((metric, index) => (
          <motion.div
            key={metric.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.25 }}
            className="h-full"
          >
            <Card className="hospital-glass h-full">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{metric.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold sm:text-3xl">{metric.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="hospital-glass">
        <CardHeader>
          <CardTitle>All Entered Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exact Date</TableHead>
                  <TableHead>Exact Time</TableHead>
                  <TableHead className="text-right">Total Beds</TableHead>
                  <TableHead className="text-right">Occupied</TableHead>
                  <TableHead className="text-right">Closed</TableHead>
                  <TableHead className="text-right">Vacant</TableHead>
                  <TableHead className="text-right">Waiting Patients</TableHead>
                  <TableHead>Reason for Closure</TableHead>
                  <TableHead className="text-right">Occupancy Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                      No entries found for the selected date/time filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const userDateTime = extractUserInputDateTime(row);
                    const customFields = (row.custom_fields as Record<string, unknown>) ?? {};
                    const waitingDirect = customFields.waiting_patients ?? customFields.waitingPatients;
                    const waitingDetected = Object.entries(customFields).find(([key]) =>
                      key.toLowerCase().includes("waiting") && key.toLowerCase().includes("patient"),
                    )?.[1];

                    const waitingValue =
                      typeof waitingDirect === "number"
                        ? waitingDirect
                        : typeof waitingDirect === "string"
                          ? Number(waitingDirect) || 0
                          : typeof waitingDetected === "number"
                            ? waitingDetected
                            : typeof waitingDetected === "string"
                              ? Number(waitingDetected) || 0
                              : 0;

                    const vacant = Math.max((Number(row.total_beds) || 0) - (Number(row.occupied) || 0) - (Number(row.closed) || 0), 0);
                    const rowOccupancy = row.total_beds > 0 ? (row.occupied / row.total_beds) * 100 : 0;

                    return (
                      <TableRow key={row.id}>
                        <TableCell>{userDateTime?.date ?? "-"}</TableCell>
                        <TableCell>{userDateTime?.time ?? "-"}</TableCell>
                        <TableCell className="text-right font-medium">{row.total_beds}</TableCell>
                        <TableCell className="text-right">{row.occupied}</TableCell>
                        <TableCell className="text-right">{row.closed}</TableCell>
                        <TableCell className="text-right">{vacant}</TableCell>
                        <TableCell className="text-right">{waitingValue}</TableCell>
                        <TableCell>{row.closure_reason || "-"}</TableCell>
                        <TableCell className="text-right">{rowOccupancy.toFixed(1)}%</TableCell>
                      </TableRow>
                    );
                  })
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
