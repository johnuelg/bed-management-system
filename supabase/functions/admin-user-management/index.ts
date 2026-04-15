import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const getEnv = (primary: string, fallback?: string) => {
  const value = Deno.env.get(primary) ?? (fallback ? Deno.env.get(fallback) : undefined);
  return value?.trim() || null;
};

type Action =
  | {
      action: "create_user";
      email: string;
      password: string;
      display_name: string;
      role: "admin" | "director" | "doctor" | "nurse" | "staff";
    }
  | {
      action: "set_user_active";
      user_id: string;
      is_active: boolean;
    };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY");
    const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing Supabase environment variables", {
        hasUrl: Boolean(supabaseUrl),
        hasAnonKey: Boolean(supabaseAnonKey),
        hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
      });

      return new Response(JSON.stringify({ error: "Server configuration error: missing Supabase credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: caller },
      error: callerError,
    } = await callerClient.auth.getUser();

    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: isAdmin, error: adminCheckError } = await callerClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });

    if (adminCheckError || !isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Action;
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    if (body.action === "create_user") {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
      });

      if (createError || !created.user) {
        throw new Error(createError?.message ?? "Failed to create auth user");
      }

      const userId = created.user.id;

      const { error: profileError } = await adminClient.from("profiles").upsert({
        user_id: userId,
        display_name: body.display_name,
        is_active: true,
      });

      if (profileError) throw profileError;

      const { error: roleDeleteError } = await adminClient.from("user_roles").delete().eq("user_id", userId);
      if (roleDeleteError) throw roleDeleteError;

      const { error: roleInsertError } = await adminClient.from("user_roles").insert({
        user_id: userId,
        role: body.role,
      });
      if (roleInsertError) throw roleInsertError;

      return new Response(JSON.stringify({ success: true, user_id: userId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "set_user_active") {
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ is_active: body.is_active })
        .eq("user_id", body.user_id);
      if (profileError) throw profileError;

      const { error: authError } = await adminClient.auth.admin.updateUserById(body.user_id, {
        ban_duration: body.is_active ? "none" : "876000h",
      });
      if (authError) throw authError;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unsupported action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
