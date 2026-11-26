// DRAFT: no desplegar antes de probar la migración en un entorno aislado.
// Edge Function: christmas-tree-claim. El cliente nunca elige moneda, monto ni perfil.
const allowedOrigin = "https://geovanyrk.github.io";
const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "Vary": "Origin",
};
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}
Deno.serve(async (req: Request) => {
  if (req.headers.get("origin") && req.headers.get("origin") !== allowedOrigin) return reply({ status: "forbidden" },403);
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers});
  if (req.method !== "POST") return reply({status:"method_not_allowed"},405);
  if (Deno.env.get("CHRISTMAS_TREE_ENABLED") !== "true") return reply({status:"disabled"},503);
  const base = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !anon || !service) return reply({status:"unavailable"},503);
  const authorization = req.headers.get("Authorization");
  if (!authorization || !/^Bearer [^ ]+$/.test(authorization)) return reply({status:"login_required"},401);
  try {
    const auth = await fetch(base + "/auth/v1/user", {headers:{apikey:anon,Authorization:authorization}});
    if (!auth.ok) return reply({status:"login_required"},401);
    const user = await auth.json();
    if (typeof user.id !== "string") return reply({status:"login_required"},401);
    // Solo acepta un número de regalo. Nunca acepta user_id, reward, amount o fecha del cliente.
    const body = await req.json().catch(()=>null);
    if (!body || !Number.isInteger(body.gift) || body.gift<1 || body.gift>5) return reply({status:"invalid_gift"},400);
    const rpc = await fetch(base+"/rest/v1/rpc/christmas_tree_claim_v1",{
      method:"POST",headers:{apikey:service,Authorization:"Bearer "+service,"Content-Type":"application/json"},
      body:JSON.stringify({p_profile:user.id,p_gift:body.gift}),
    });
    if (!rpc.ok) return reply({status:"claim_unavailable"},503);
    return reply(await rpc.json());
  } catch {
    return reply({status:"claim_unavailable"},503);
  }
});
