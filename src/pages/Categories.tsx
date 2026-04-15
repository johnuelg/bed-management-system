import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchBedTypes,
  fetchDepartments,
  saveBedType,
  saveDepartment,
  toggleBedTypeActive,
  toggleDepartmentActive,
} from "@/lib/supabase-api";

const CategoriesPage = () => {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [dept, setDept] = useState({ name: "", code: "" });
  const [bedType, setBedType] = useState({ name: "" });

  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const { data: bedTypes = [] } = useQuery({ queryKey: ["bed_types"], queryFn: fetchBedTypes });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["departments"] });
    await qc.invalidateQueries({ queryKey: ["bed_types"] });
  };

  const deptMutation = useMutation({
    mutationFn: () => saveDepartment(roles, { ...dept }),
    onSuccess: async () => {
      setDept({ name: "", code: "" });
      toast({ title: "Department saved" });
      await refresh();
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  const bedMutation = useMutation({
    mutationFn: () => saveBedType(roles, { ...bedType }),
    onSuccess: async () => {
      setBedType({ name: "" });
      toast({ title: "Bed type saved" });
      await refresh();
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Departments & Bed Types</h1>
        <p className="text-sm text-muted-foreground">Soft delete is used to preserve historical bed records.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Departments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={dept.name} onChange={(e) => setDept((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Code</Label>
                <Input value={dept.code} onChange={(e) => setDept((p) => ({ ...p, code: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <Button onClick={() => deptMutation.mutate()}>Add / Update Department</Button>
            <div className="space-y-3">
              {departments.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.code}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span>{item.is_active ? "Active" : "Inactive"}</span>
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={(checked) => {
                        void toggleDepartmentActive(roles, item.id, checked).then(refresh);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bed Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={bedType.name} onChange={(e) => setBedType({ name: e.target.value })} />
            </div>
            <Button onClick={() => bedMutation.mutate()}>Add / Update Bed Type</Button>
            <div className="space-y-3">
              {bedTypes.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-md border p-3">
                  <p className="font-semibold">{item.name}</p>
                  <div className="flex items-center gap-2 text-sm">
                    <span>{item.is_active ? "Active" : "Inactive"}</span>
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={(checked) => {
                        void toggleBedTypeActive(roles, item.id, checked).then(refresh);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

export default CategoriesPage;
