import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { CalendarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchDashboardSubmissions, aggregateSubmissionSums } from "@/lib/supabase-api";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";

const DashboardPage = () => {
  const qc = useQueryClient();
  const today = useMemo(() => new Date(), []);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: today, to: today });
  const [timeFrom, setTimeFrom] = useState("00:00");
  const [timeTo, setTimeTo] = useState("23:59");
  const rangeStart = dateRange?.from ?? today;
  const rangeEnd = dateRange?.to ?? dateRange?.from ?? today;

  const rangeStartIso = useMemo(() => format(rangeStart, "yyyy-MM-dd"), [rangeStart]);
  const rangeEndIso = useMemo(() => format(rangeEnd, "yyyy-MM-dd"), [rangeEnd]);

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
                {format(rangeStart, "MMM d, yyyy")} - {format(rangeEnd, "MMM d, yyyy")}
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
