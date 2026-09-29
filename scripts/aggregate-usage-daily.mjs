// Rebuild only the selected Shanghai days, atomically, from persisted facts.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { dayRange, shanghaiDay } from "../lib/format.ts";

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => { const [key, ...rest] = arg.slice(2).split("="); return [key, rest.join("=")]; }));
const from = args.from || shanghaiDay(new Date(Date.now() - 13 * 86400000));
const to = args.to || shanghaiDay(new Date());
const range = dayRange(from, to);
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("缺少 DATABASE_URL。");
const schema = new URL(connectionString).searchParams.get("schema") || "public";
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error("Invalid schema");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: "-c search_path=" + schema }, { schema }) });
const values = [range.gte, range.lt, args.projectId || null];
const base = 'WITH r AS (SELECT *, (started_at + interval \'8 hours\')::date AS day FROM trace_run WHERE started_at >= $1::timestamp AND started_at < $2::timestamp AND ($3::uuid IS NULL OR project_id=$3::uuid)), ' +
  's AS (SELECT s.*, r.project_id, r.day, r.status AS run_status, r.latency_ms AS run_latency FROM trace_span s JOIN r ON r.id=s.run_id) ';
try {
  const counts = await db.$transaction(async (tx) => {
    // Serializes concurrent rebuilds, including overlapping all-project scopes.
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(74204621)");
    await tx.usageDaily.deleteMany({ where: { date: { gte: new Date(from + "T00:00:00Z"), lte: new Date(to + "T00:00:00Z") }, ...(args.projectId ? { projectId: args.projectId } : {}) } });
    const projectRows = await tx.$executeRawUnsafe(base + ', t AS (SELECT run_id, SUM(prompt_tokens) AS pt, SUM(completion_tokens) AS ct FROM s GROUP BY run_id) ' +
      'INSERT INTO usage_daily (id,project_id,model_config_id,date,request_count,success_count,failure_count,prompt_tokens,completion_tokens,total_cost,average_latency_ms) ' +
      'SELECT gen_random_uuid(),r.project_id,NULL,r.day,count(*),count(*) FILTER(WHERE r.status=\'success\'),count(*) FILTER(WHERE r.status IN (\'failed\',\'cancelled\')),COALESCE(sum(t.pt),0),COALESCE(sum(t.ct),0),COALESCE(sum(r.cost),0),round(avg(r.latency_ms)) FROM r LEFT JOIN t ON t.run_id=r.id GROUP BY r.project_id,r.day', ...values);
    const modelRows = await tx.$executeRawUnsafe(base + ', m AS (SELECT s.*, c.id AS model_id FROM s JOIN LATERAL (SELECT mc.id FROM model_config mc JOIN model_provider mp ON mp.id=mc.provider_id WHERE mc.model_name=s.model AND lower(mp.name)=lower(s.provider) ORDER BY mc.created_at,mc.id LIMIT 1) c ON true), ' +
      'per_run AS (SELECT project_id,day,model_id,run_id,run_status,run_latency,sum(prompt_tokens) AS pt,sum(completion_tokens) AS ct,sum(cost) AS cost FROM m GROUP BY project_id,day,model_id,run_id,run_status,run_latency) ' +
      'INSERT INTO usage_daily (id,project_id,model_config_id,date,request_count,success_count,failure_count,prompt_tokens,completion_tokens,total_cost,average_latency_ms) ' +
      'SELECT gen_random_uuid(),project_id,model_id,day,count(*),count(*) FILTER(WHERE run_status=\'success\'),count(*) FILTER(WHERE run_status IN (\'failed\',\'cancelled\')),COALESCE(sum(pt),0),COALESCE(sum(ct),0),COALESCE(sum(cost),0),round(avg(run_latency)) FROM per_run GROUP BY project_id,day,model_id', ...values);
    return { projectRows, modelRows };
  }, { isolationLevel: "Serializable", timeout: 30000 });
  console.log(JSON.stringify({ from, to, timezone: "Asia/Shanghai", ...counts }));
} finally { await db.$disconnect(); }
