import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BedDouble, Ban, UserRound, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  fetchDepartments,
  fetchDepartmentTotalBeds,
  fetchTodaySubmissions,
  fetchOccupancyBenchmarkSettings,
} from "@/lib/supabase-api";
import type { BedSubmission, OccupancyBenchmarkSettings } from "@/types/hospital";

type BedStatus = "occupied" | "closed" | "vacant";

type BedCell = {
  index: number;
  label: string;
  status: BedStatus;
};

type DepartmentBeds = {
  id: string;
  name: string;
  code: string;
  totalBeds: number;
  occupied: number;
  closed: number;
  vacant: number;
  beds: BedCell[];
};

const statusStyles: Record<
  BedStatus,
  { label: string; icon: typeof BedDouble; card: string; iconColor: string; badge: string }
> = {
  occupied: {
    label: "Occupied",
    icon: UserRound,
    card: "border-destructive/40 bg-destructive/5 hover:border-destructive",
    iconColor: "text-destructive",
    badge: "bg-destructive/10 text-destructive border-destructive/30",
  },
  closed: {
    label: "Closed",
    icon: Ban,
    card: "border-muted-foreground/30 bg-muted/40 hover:border-muted-foreground/60",
    iconColor: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground border-muted-foreground/30",
  },
  vacant: {
    label: "Vacant",
    icon: CheckCircle2,
    card: "border-primary/30 bg-primary/5 hover:border-primary",
    iconColor: "text-primary",
    badge: "bg-primary/10 text-primary border-primary/30",
  },
};

// Sum today's submissions per department across all bed types.
// For duplicate rows (same department + bed_type), keep only the most recent
// (rows are pre-sorted DESC by updated_at in fetchTodaySubmissions).
const readNumberField = (source: Record<string, unknown> | null | undefined, key: string) => {
  const value = source?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const getEffectiveOccupied = (row: BedSubmission) => {
  const calculatedOccupied = readNumberField(row.calculated_fields, "occupied_auto");
  if (calculatedOccupied !== undefined) return calculatedOccupied;

  const rawOccupied = Number(row.occupied) || 0;
  return rawOccupied > 0 ? rawOccupied : readNumberField(row.custom_fields, "occupied") ?? 0;
};

const getEffectiveClosed = (row: BedSubmission) => {
  const rawClosed = Number(row.closed) || 0;
  return rawClosed > 0 ? rawClosed : readNumberField(row.custom_fields, "closed") ?? 0;
};

const aggregateByDepartment = (rows: BedSubmission[]) => {
  const seen = new Set<string>();
  const map = new Map<string, { occupied: number; closed: number }>();
  for (const row of rows) {
    const dedupeKey = `${row.department_id}::${row.bed_type_id ?? "_"}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const cur = map.get(row.department_id) ?? { occupied: 0, closed: 0 };
    cur.occupied += getEffectiveOccupied(row);
    cur.closed += getEffectiveClosed(row);
    map.set(row.department_id, cur);
  }
  return map;
};

const BedMapPage = () => {
  const { data: departments, isLoading: loadingDepartments } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
  });

  const { data: totalBedsMap, isLoading: loadingTotals } = useQuery({
    queryKey: ["app_settings", "department_total_beds"],
    queryFn: fetchDepartmentTotalBeds,
  });

  const { data: todaySubmissions, isLoading: loadingSubmissions } = useQuery({
    queryKey: ["bed_submissions", "today"],
    queryFn: fetchTodaySubmissions,
  });

  const { data: benchmarkSettings } = useQuery({
    queryKey: ["app_settings", "occupancy_benchmark"],
    queryFn: fetchOccupancyBenchmarkSettings,
  });

  const isLoading = loadingDepartments || loadingTotals || loadingSubmissions;

  const grouped: DepartmentBeds[] = useMemo(() => {
    if (!departments) return [];
    const aggMap = aggregateByDepartment(todaySubmissions ?? []);

    return departments
      .filter((d) => d.is_active)
      .map((dept) => {
        const total = Math.max(0, Number(totalBedsMap?.[dept.id] ?? 0) | 0);
        const agg = aggMap.get(dept.id);
        const rawOccupied = Math.max(0, Number(agg?.occupied ?? 0) | 0);
        const rawClosed = Math.max(0, Number(agg?.closed ?? 0) | 0);
        // Cap to avoid overflow if submission exceeds configured total
        const occupied = Math.min(rawOccupied, total);
        const closed = Math.min(rawClosed, Math.max(0, total - occupied));
        const vacant = Math.max(0, total - occupied - closed);

        const beds: BedCell[] = Array.from({ length: total }, (_, i) => {
          const index = i + 1;
          let status: BedStatus;
          if (index <= occupied) status = "occupied";
          else if (index <= occupied + closed) status = "closed";
          else status = "vacant";
          return {
            index,
            label: `${dept.code || dept.name} ${index}`,
            status,
          };
        });

        return {
          id: dept.id,
          name: dept.name,
          code: dept.code,
          totalBeds: total,
          occupied,
          closed,
          vacant,
          beds,
        };
      });
  }, [departments, totalBedsMap, todaySubmissions]);

  const totals = grouped.reduce(
    (acc, g) => ({
      total: acc.total + g.totalBeds,
      occupied: acc.occupied + g.occupied,
      closed: acc.closed + g.closed,
      vacant: acc.vacant + g.vacant,
    }),
    { total: 0, occupied: 0, closed: 0, vacant: 0 },
  );

  const getOccupancyRate = (occupied: number, total: number, closed: number) => {
    const denom = Math.max(0, total - closed);
    return denom > 0 ? (occupied / denom) * 100 : 0;
  };

  const formatOccupancy = (occupied: number, total: number, closed: number) => {
    const denom = Math.max(0, total - closed);
    const rate = denom > 0 ? (occupied / denom) * 100 : 0;
    return `${occupied}/${denom} beds · ${rate.toFixed(1)}%`;
  };

  // Resolve the matching KPI Benchmark level for an occupancy rate
  const benchmarkLevels = benchmarkSettings?.levels ?? [];
  const matchBenchmark = (rate: number) =>
    benchmarkLevels.find((level) => {
      const minPass =
        level.minPercent === null || level.minPercent === undefined
          ? true
          : level.minInclusive
            ? rate >= level.minPercent
            : rate > level.minPercent;
      const maxPass =
        level.maxPercent === null || level.maxPercent === undefined
          ? true
          : level.maxInclusive
            ? rate <= level.maxPercent
            : rate < level.maxPercent;
      return minPass && maxPass;
    });

  const benchmarkBadgeStyle = (rate: number): React.CSSProperties => {
    const level = matchBenchmark(rate);
    if (!level?.color) return {};
    return {
      backgroundColor: `${level.color}1a`,
      borderColor: `${level.color}66`,
      color: level.color,
    };
  };

  const benchmarkLabel = (rate: number) => matchBenchmark(rate)?.label;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bed Map</h1>
          <p className="text-sm text-muted-foreground">
            Live bed status from the latest entry per department (today).
          </p>
        </div>
        {!isLoading && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="text-sm">
              {grouped.length} departments · {totals.total} beds
            </Badge>
            <Badge variant="outline" className={statusStyles.occupied.badge}>
              {totals.occupied} Occupied
            </Badge>
            <Badge variant="outline" className={statusStyles.closed.badge}>
              {totals.closed} Closed
            </Badge>
            <Badge variant="outline" className={statusStyles.vacant.badge}>
              {totals.vacant} Vacant
            </Badge>
            <Badge
              variant="outline"
              className={occupancyBadgeClass(getOccupancyRate(totals.occupied, totals.total, totals.closed))}
            >
              Occupancy Rate {formatOccupancy(totals.occupied, totals.total, totals.closed)}
            </Badge>
          </div>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <BedDouble className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No active departments configured. Add departments and set Total Beds in Categories.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map((dept) => (
            <Card key={dept.id} className="overflow-hidden">
              <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="truncate text-lg sm:text-xl">{dept.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">Code: {dept.code || "—"}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="shrink-0">
                    {dept.totalBeds} beds
                  </Badge>
                  <Badge variant="outline" className={statusStyles.occupied.badge}>
                    {dept.occupied} Occupied
                  </Badge>
                  <Badge variant="outline" className={statusStyles.closed.badge}>
                    {dept.closed} Closed
                  </Badge>
                  <Badge variant="outline" className={statusStyles.vacant.badge}>
                    {dept.vacant} Vacant
                  </Badge>
                  <Badge
                    variant="outline"
                    className={occupancyBadgeClass(getOccupancyRate(dept.occupied, dept.totalBeds, dept.closed))}
                  >
                    Occupancy Rate {formatOccupancy(dept.occupied, dept.totalBeds, dept.closed)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {dept.totalBeds === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No Total Beds configured for this department.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                    {dept.beds.map((bed) => {
                      const s = statusStyles[bed.status];
                      const Icon = s.icon;
                      return (
                        <div
                          key={bed.index}
                          className={cn(
                            "hospital-transition flex aspect-square flex-col items-center justify-center rounded-lg border p-2 text-center shadow-sm hover:shadow-md",
                            s.card,
                          )}
                          title={`${bed.label} · ${s.label}`}
                        >
                          <Icon className={cn("h-5 w-5", s.iconColor)} />
                          <span className="mt-1 text-xs font-semibold leading-tight">
                            {dept.code || dept.name}
                          </span>
                          <span className="text-sm font-bold text-foreground">#{bed.index}</span>
                          <span className={cn("text-[10px] font-medium uppercase tracking-wide", s.iconColor)}>
                            {s.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default BedMapPage;
