import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { fetchFormFields, replaceFormFieldOrder, saveFormField } from "@/lib/supabase-api";
import type { AppRole, FormField } from "@/types/hospital";

const roleOptions: AppRole[] = ["admin", "director", "doctor", "nurse", "staff"];
const fieldTypes: FormField["field_type"][] = ["number", "text", "textarea", "select", "boolean", "date", "formula"];

const SortableFieldItem = ({ field }: { field: FormField }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: field.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="hospital-transition flex items-center justify-between rounded-md border bg-card p-3"
    >
      <div>
        <p className="font-semibold">{field.label}</p>
        <p className="text-xs text-muted-foreground">
          {field.field_key} • {field.field_type} • {field.is_readonly ? "read-only" : "editable"}
        </p>
      </div>
      <button type="button" className="rounded border p-2" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  );
};

const FormBuilderPage = () => {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor));

  const [draft, setDraft] = useState<Partial<FormField>>({
    field_key: "",
    label: "",
    field_type: "number",
    editable_roles: ["admin"],
    default_value: "",
    is_required: false,
    is_readonly: false,
  });

  const { data: fields = [] } = useQuery({ queryKey: ["form_fields"], queryFn: fetchFormFields });
  const sortedFields = useMemo(() => [...fields].sort((a, b) => a.display_order - b.display_order), [fields]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveFormField(roles, {
        field_key: String(draft.field_key || "").trim().toLowerCase().replace(/\s+/g, "_"),
        label: String(draft.label || "").trim(),
        field_type: (draft.field_type as FormField["field_type"]) || "number",
        is_required: Boolean(draft.is_required),
        is_readonly: Boolean(draft.is_readonly),
        is_system: false,
        is_active: true,
        display_order: sortedFields.length + 1,
        default_value: (draft.default_value as string) || null,
        options: draft.options ?? [],
        editable_roles: (draft.editable_roles as AppRole[]) || ["admin"],
      }),
    onSuccess: async () => {
      toast({ title: "Field saved" });
      setDraft({ field_key: "", label: "", field_type: "number", editable_roles: ["admin"], default_value: "", is_required: false, is_readonly: false });
      await qc.invalidateQueries({ queryKey: ["form_fields"] });
    },
    onError: (error) => toast({ title: "Save failed", description: (error as Error).message, variant: "destructive" }),
  });

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedFields.findIndex((f) => f.id === active.id);
    const newIndex = sortedFields.findIndex((f) => f.id === over.id);
    const reordered = arrayMove(sortedFields, oldIndex, newIndex);

    try {
      await replaceFormFieldOrder(roles, reordered.map((f) => f.id));
      await qc.invalidateQueries({ queryKey: ["form_fields"] });
      toast({ title: "Form order updated" });
    } catch (error) {
      toast({ title: "Reorder failed", description: (error as Error).message, variant: "destructive" });
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Dynamic Form Builder</h1>
        <p className="text-sm text-muted-foreground">Drag, reorder, and role-scope custom fields.</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>Add Field</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={String(draft.label || "")} onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Field Key</Label>
              <Input value={String(draft.field_key || "")} onChange={(e) => setDraft((p) => ({ ...p, field_key: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Field Type</Label>
              <Select value={String(draft.field_type || "number")} onValueChange={(value) => setDraft((p) => ({ ...p, field_type: value as FormField["field_type"] }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fieldTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Value</Label>
              <Input value={String(draft.default_value || "")} onChange={(e) => setDraft((p) => ({ ...p, default_value: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Editable Roles</Label>
              <div className="grid grid-cols-2 gap-2">
                {roleOptions.map((role) => {
                  const selected = (draft.editable_roles as AppRole[] | undefined)?.includes(role);
                  return (
                    <label key={role} className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) => {
                          setDraft((prev) => {
                            const list = (prev.editable_roles as AppRole[] | undefined) ?? [];
                            return {
                              ...prev,
                              editable_roles: checked ? [...new Set([...list, role])] : list.filter((r) => r !== role),
                            };
                          });
                        }}
                      />
                      {role}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={Boolean(draft.is_required)}
                  onCheckedChange={(value) => setDraft((p) => ({ ...p, is_required: Boolean(value) }))}
                />
                Required
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={Boolean(draft.is_readonly)}
                  onCheckedChange={(value) => setDraft((p) => ({ ...p, is_readonly: Boolean(value) }))}
                />
                Read-only
              </label>
            </div>

            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              Save Field
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Field Order</CardTitle>
          </CardHeader>
          <CardContent>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
              <SortableContext items={sortedFields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {sortedFields.map((field) => (
                    <SortableFieldItem key={field.id} field={field} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

export default FormBuilderPage;
