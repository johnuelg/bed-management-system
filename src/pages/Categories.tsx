import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  deleteDepartment,
  fetchDepartments,
  saveDepartment,
  toggleDepartmentActive,
  updateDepartment,
} from "@/lib/supabase-api";

const CategoriesPage = () => {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [dept, setDept] = useState({ name: "", code: "" });
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [departmentToDelete, setDepartmentToDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["departments"] });
  };

  const deptMutation = useMutation({
    mutationFn: () => {
      if (editingDepartmentId) {
        return updateDepartment(roles, editingDepartmentId, { ...dept });
      }
      return saveDepartment(roles, { ...dept });
    },
    onSuccess: async () => {
      setDept({ name: "", code: "" });
      setEditingDepartmentId(null);
      toast({ title: editingDepartmentId ? "Department updated" : "Department saved" });
      await refresh();
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  const deleteDepartmentMutation = useMutation({
    mutationFn: (id: string) => deleteDepartment(roles, id),
    onSuccess: async () => {
      if (editingDepartmentId) {
        setDept({ name: "", code: "" });
        setEditingDepartmentId(null);
      }
      toast({ title: "Department deleted" });
      await refresh();
    },
    onError: (error) => toast({ title: "Delete failed", description: (error as Error).message, variant: "destructive" }),
  });

  return (
    <section className="space-y-5 sm:space-y-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">Departments</h1>
        <p className="text-sm text-muted-foreground">Soft delete is used to preserve historical bed records.</p>
      </header>

      <div className="grid gap-6">
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
            {editingDepartmentId ? (
              <p className="text-sm text-muted-foreground">Editing Department: Name and Code are loaded below.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => deptMutation.mutate()}>
                {editingDepartmentId ? "Update Department" : "Add Department"}
              </Button>
              {editingDepartmentId ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingDepartmentId(null);
                    setDept({ name: "", code: "" });
                  }}
                >
                  Cancel Edit
                </Button>
              ) : null}
            </div>
            <div className="space-y-3">
              {departments.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.code}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingDepartmentId(item.id);
                        setDept({ name: item.name, code: item.code });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDepartmentToDelete({ id: item.id, name: item.name })}
                      disabled={deleteDepartmentMutation.isPending}
                    >
                      Delete
                    </Button>
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
      </div>

      <AlertDialog open={Boolean(departmentToDelete)} onOpenChange={(open) => !open && setDepartmentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete department?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <span className="font-semibold">{departmentToDelete?.name}</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (departmentToDelete) {
                  deleteDepartmentMutation.mutate(departmentToDelete.id);
                }
                setDepartmentToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default CategoriesPage;
