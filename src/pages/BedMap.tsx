import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BedDouble } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchDepartments, fetchDepartmentTotalBeds } from "@/lib/supabase-api";

type BedCell = { label: string; index: number };

type DepartmentBeds = {
  id: string;
  name: string;
  code: string;
  totalBeds: number;
  beds: BedCell[];
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

  const isLoading = loadingDepartments || loadingTotals;

  const grouped: DepartmentBeds[] = useMemo(() => {
    if (!departments) return [];
    return departments
      .filter((d) => d.is_active)
      .map((dept) => {
        const total = Math.max(0, Number(totalBedsMap?.[dept.id] ?? 0) | 0);
        const beds: BedCell[] = Array.from({ length: total }, (_, i) => ({
          index: i + 1,
          label: `${dept.code || dept.name} ${i + 1}`,
        }));
        return {
          id: dept.id,
          name: dept.name,
          code: dept.code,
          totalBeds: total,
          beds,
        };
      });
  }, [departments, totalBedsMap]);

  const totalAllBeds = grouped.reduce((acc, g) => acc + g.totalBeds, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bed Map</h1>
          <p className="text-sm text-muted-foreground">
            Individual bed cards generated from Categories configuration.
          </p>
        </div>
        {!isLoading && (
          <Badge variant="secondary" className="w-fit text-sm">
            {grouped.length} departments · {totalAllBeds} beds
          </Badge>
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
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-lg sm:text-xl">{dept.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">Code: {dept.code || "—"}</p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {dept.totalBeds} beds
                </Badge>
              </CardHeader>
              <CardContent>
                {dept.totalBeds === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No Total Beds configured for this department.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                    {dept.beds.map((bed) => (
                      <div
                        key={bed.index}
                        className="hospital-transition flex aspect-square flex-col items-center justify-center rounded-lg border bg-card p-2 text-center shadow-sm hover:border-primary/60 hover:shadow-md"
                      >
                        <BedDouble className="h-5 w-5 text-primary" />
                        <span className="mt-1 text-xs font-semibold leading-tight">
                          {dept.code || dept.name}
                        </span>
                        <span className="text-sm font-bold text-foreground">#{bed.index}</span>
                      </div>
                    ))}
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
