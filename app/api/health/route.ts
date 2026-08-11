export async function GET() {
  return Response.json(
    {
      status: "ok",
      service: "retirement-simulation",
      models: ["model_a", "model_b"],
      execution: "browser_web_worker",
      hosted_path_cap: 100_000,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
