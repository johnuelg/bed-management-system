import { BarChart3, FileDown, LineChart, PieChart } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const plannedSections: Array<{ icon: typeof BarChart3; title: string; description: string }> = [
  {
    icon: PieChart,
    title: "KPI summary cards",
    description: "Aggregated occupancy, closures, and bed utilization for any selected date range.",
  },
  {
    icon: BarChart3,
    title: "Department comparison",
    description: "Side-by-side bar charts comparing beds, occupancy, and closures across departments.",
  },
  {
    icon: LineChart,
    title: "Occupancy trends",
    description: "Daily and weekly line/area charts showing occupancy % per department over time.",
  },
  {
    icon: FileDown,
    title: "Export to CSV / PDF",
    description: "Download filtered report data for sharing and offline review.",
  },
];

const ReportsAnalyticsPage = () => {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Reports & Analytics</h1>
        <p className="text-muted-foreground">
          Visual reports and exportable analytics for bed occupancy and department performance.
        </p>
      </header>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            This page is a placeholder. The sections below outline what will be available once the full report
            module ships.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {plannedSections.map((section) => (
          <Card key={section.title}>
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <section.icon className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex h-32 items-center justify-center rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground">
                Preview coming soon
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ReportsAnalyticsPage;