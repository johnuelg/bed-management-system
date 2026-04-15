import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { createUserByAdmin, deactivateUserByAdmin, fetchProfiles, fetchUserRoles, setUserRole } from "@/lib/supabase-api";
import type { AppRole } from "@/types/hospital";

const roleOptions: AppRole[] = ["admin", "director", "doctor", "nurse", "staff"];

const UsersPage = () => {
  const { roles } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "staff" as AppRole });

  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const { data: roleMap = {} } = useQuery({ queryKey: ["user_roles"], queryFn: () => fetchUserRoles() });

  const users = useMemo(
    () =>
      profiles.map((profile) => ({
        ...profile,
        role: roleMap[profile.user_id]?.[0] ?? "staff",
      })),
    [profiles, roleMap],
  );

  const createMutation = useMutation({
    mutationFn: () => createUserByAdmin(roles, form),
    onSuccess: async () => {
      toast({ title: "User created" });
      setForm({ email: "", password: "", display_name: "", role: "staff" });
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["user_roles"] });
    },
    onError: (error) => toast({ title: "Create failed", description: (error as Error).message, variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AppRole }) => setUserRole(roles, userId, role),
    onSuccess: async () => {
      toast({ title: "Role updated" });
      await queryClient.invalidateQueries({ queryKey: ["user_roles"] });
    },
    onError: (error) => toast({ title: "Role update failed", description: (error as Error).message, variant: "destructive" }),
  });

  const activeMutation = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) => deactivateUserByAdmin(roles, userId, active),
    onSuccess: async () => {
      toast({ title: "User status updated" });
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (error) => toast({ title: "Status update failed", description: (error as Error).message, variant: "destructive" }),
  });

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">User Management</h1>
        <p className="text-sm text-muted-foreground">Admin-only user CRUD and secure role assignment.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Create User</CardTitle>
          <CardDescription>No public signup is enabled; create users here.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input value={form.display_name} onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Temporary Password</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(value) => setForm((p) => ({ ...p, role: value as AppRole }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            Create User
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Users</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.display_name ?? "Unnamed"}</TableCell>
                  <TableCell>
                    <Select
                      value={user.role}
                      onValueChange={(value) => roleMutation.mutate({ userId: user.user_id, role: value as AppRole })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roleOptions.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{user.is_active ? "Active" : "Inactive"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={user.is_active ? "destructive" : "secondary"}
                      onClick={() => activeMutation.mutate({ userId: user.user_id, active: !user.is_active })}
                    >
                      {user.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
};

export default UsersPage;
