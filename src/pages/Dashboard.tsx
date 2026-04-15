import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchTodaySubmissions, aggregateSubmissionSums } from "@/lib/supabase-api";
import { supabase } from "@/integrations/supabase/client";

const DashboardPage = () => {
  const qc = useQueryClient();

  const { data: rows = [] } = useQuery({ queryKey: ["bed_submissions_today"], queryFn: fetchTodaySubmissions });

  const sums = aggregateSubmissionSums(rows);
  const occupancyRate = sums.total_beds > 0 ? (sums.occupied / sums.total_beds) * 100 : 0;

  useEffect(() => {
    const debouncedRefresh = () => {
      const timeout = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["bed_submissions_today"] });
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
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Live Hospital Dashboard</h1>
        <p className="text-sm text-muted-foreground">Realtime, free-tier-safe metrics with manual refresh support.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { name: "Total Beds", value: sums.total_beds },
          { name: "Occupied", value: sums.occupied },
          { name: "Closed", value: sums.closed },
          { name: "Occupancy Rate", value: `${occupancyRate.toFixed(1)}%` },
        ].map((metric, index) => (
          <motion.div
            key={metric.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.25 }}
          >
            <Card className="hospital-glass">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">{metric.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{metric.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

export default DashboardPage;
