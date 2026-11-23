import { CreateRunSchema } from "@/lib/agents/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/authenticated-user";

export async function POST(request: Request) {
  const { user, error: authError } = await getAuthenticatedUser();
  if (authError || !user) {
    const status = authError?.status && authError.status >= 500 ? 503 : 401;
    return Response.json({ error: "Authentication is required." }, { status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = CreateRunSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Request must contain a prompt of 1 to 4000 characters." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: runId, error } = await admin.rpc("create_agent_run", {
    p_owner_id: user.id,
    p_request: parsed.data.request,
  });

  if (error) {
    if (error.code === "P0001" && error.message === "RUN_RATE_LIMIT") {
      return Response.json(
        { error: "Run limit reached. Try again in an hour." },
        { status: 429 },
      );
    }

    console.error("Could not create agent run.", {
      code: error.code,
      ownerId: user.id,
    });
    return Response.json({ error: "Could not create the run." }, { status: 500 });
  }

  return Response.json({ runId }, { status: 201 });
}
