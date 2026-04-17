import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { CalendarIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchSubmissionsByDateRange, aggregateSubmissionSums } from "@/lib/supabase-api";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";

const DashboardPage = () => {
  const qc = useQueryClient();
  const today = useMemo(() => new Date(), []);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: today, to: today });
  const rangeStart = dateRange?.from ?? today;
  const rangeEnd = dateRange?.to ?? dateRange?.from ?? today;

  const rangeStartIso = useMemo(() => format(rangeStart, "yyyy-MM-dd"), [rangeStart]);
  const rangeEndIso = useMemo(() => format(rangeEnd, "yyyy-MM-dd"), [rangeEnd]);

  const { data: rows = [] } = useQuery({
    queryKey: ["bed_submissions_range", rangeStartIso, rangeEndIso],
    queryFn: () => fetchSubmissionsByDateRange(rangeStartIso, rangeEndIso),
  });

  const sums = aggregateSubmissionSums(rows);
  const waitingPatients = rows.reduce((total, row) => {
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
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-start text-left font-normal sm:w-auto">
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
    </section>
  );
};

export default DashboardPage;
