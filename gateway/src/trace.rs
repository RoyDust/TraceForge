//! Trace 采集写库管线 (Stage 2)。
//!
//! 主转发路径只负责「组装」一次调用的 TraceJob 并 `submit`，落库交给独立 async worker：
//! 有界 channel + 单写 worker，绝不阻塞主转发 (决策 6/7)。队列满则整条丢弃。
//!
//! 当前覆盖 Stage 2: 非流式/流式自动 Trace、usage 采集或估算、成本核算、事件写入与基础可靠性指标。

use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;

use chrono::NaiveDateTime;
use serde_json::Value;
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

use crate::Metrics;

const QUEUE_CAP: usize = 1024;
/// preview 截断上限 (字符数)。
const MAX_PREVIEW: usize = 2000;

/// 主路径组装、worker 落库的一次调用 Trace。
///
/// status / usage_source 用字符串 (落库时 SQL 内 `::text::枚举` 转换):
///   status ∈ success/failed/cancelled/running; usage_source ∈ provider/estimated。
pub struct TraceJob {
    pub project_id: Uuid,
    pub run_id: Uuid,
    pub span_id: Uuid,
    pub agent_run: bool,
    pub model: String,
    pub provider: String,
    pub status: &'static str,
    pub error_code: Option<String>,
    pub error: Option<String>,      // 脱敏后的错误摘要
    pub input_text: Option<String>, // 完整原文; worker 负责脱敏 + 截断成 preview
    pub output_text: Option<String>,
    pub prompt_tokens: Option<i32>,
    pub completion_tokens: Option<i32>,
    pub usage_source: Option<&'static str>,
    pub started_at: NaiveDateTime,
    pub ended_at: NaiveDateTime,
    /// false 表示鉴权/限流失败: 只写 TraceRun, 不建上游 LLM Span (§3.4)。
    pub has_span: bool,
    /// 流式细粒度事件 (stream_start/first_token/chunk_count/stream_end 等); 挂在 llm Span 下。
    pub events: Vec<EventRec>,
}

/// Gateway 接受请求后立即创建的 running Run。
pub struct TraceBegin {
    pub project_id: Uuid,
    pub run_id: Uuid,
    pub name: String,
    pub input_text: Option<String>,
    pub started_at: NaiveDateTime,
}

#[derive(Debug)]
pub enum BeginRunError {
    Conflict,
    Sql(sqlx::Error),
}

impl From<sqlx::Error> for BeginRunError {
    fn from(error: sqlx::Error) -> Self {
        BeginRunError::Sql(error)
    }
}

/// 一条 TraceEvent 记录。
pub struct EventRec {
    pub typ: &'static str, // trace_event_type 枚举值
    pub payload: Option<Value>,
    pub at: NaiveDateTime,
}

/// Trace 写入句柄: 持有有界 channel 的发送端, 主路径 `submit` 即返回。
#[derive(Clone)]
pub struct TraceWriter {
    tx: mpsc::Sender<TraceJob>,
    metrics: Arc<Metrics>,
}

impl TraceWriter {
    /// 非阻塞投递。队列满 → 整条丢弃 (best-effort, 绝不阻塞主转发)。
    pub fn submit(&self, job: TraceJob) {
        if self.tx.try_send(job).is_ok() {
            self.metrics.trace_queue_depth.fetch_add(1, Relaxed);
        } else {
            self.metrics.trace_dropped_total.fetch_add(1, Relaxed);
        }
    }
}

/// 启动写库 worker, 返回投递句柄。
pub fn spawn(pool: PgPool, metrics: Arc<Metrics>) -> TraceWriter {
    let (tx, mut rx) = mpsc::channel::<TraceJob>(QUEUE_CAP);
    let m = metrics.clone();
    tokio::spawn(async move {
        while let Some(job) = rx.recv().await {
            m.trace_queue_depth.fetch_sub(1, Relaxed);
            let mut attempt = 0;
            loop {
                match write_once(&pool, &job).await {
                    Ok(_) => break,
                    Err(e) if attempt < 2 => {
                        attempt += 1;
                        sleep(Duration::from_millis(100 * attempt)).await;
                        eprintln!(
                            "[trace] 写库失败, 将重试 run_id={} attempt={} err={e}",
                            job.run_id, attempt
                        );
                    }
                    Err(e) => {
                        m.trace_write_failed_total.fetch_add(1, Relaxed);
                        eprintln!(
                            "[trace] 写库失败, dead-letter(log) run_id={} err={e}",
                            job.run_id
                        );
                        break;
                    }
                }
            }
        }
    });
    TraceWriter { tx, metrics }
}

/// 同步保留 TraceRun id, 让详情页能作为 in-flight 调用的落地点。
pub async fn begin_run(pool: &PgPool, begin: &TraceBegin) -> Result<(), BeginRunError> {
    if run_exists(pool, begin.run_id).await? {
        return Err(BeginRunError::Conflict);
    }

    let input_preview = begin.input_text.as_deref().map(|t| preview(&sanitize(t)));
    let result = sqlx::query!(
        r#"INSERT INTO trace_run
             (id, project_id, name, status, input_preview, started_at)
           VALUES ($1,$2,$3,'running'::trace_status,$4,$5)"#,
        begin.run_id,
        begin.project_id,
        begin.name,
        input_preview,
        begin.started_at,
    )
    .execute(pool)
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(error) if is_unique_violation(&error) => Err(BeginRunError::Conflict),
        Err(error) => Err(BeginRunError::Sql(error)),
    }
}

pub async fn run_exists(pool: &PgPool, run_id: Uuid) -> Result<bool, sqlx::Error> {
    let row = sqlx::query!("SELECT id FROM trace_run WHERE id = $1 LIMIT 1", run_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(db_error) if db_error.is_unique_violation())
}

/// 落库一次 Trace: TraceRun (+ 可选 llm TraceSpan), 事务保证原子。
async fn write_once(pool: &PgPool, job: &TraceJob) -> Result<(), sqlx::Error> {
    let input_preview = job.input_text.as_deref().map(|t| preview(&sanitize(t)));
    let output_preview = job.output_text.as_deref().map(|t| preview(&sanitize(t)));
    let latency = (job.ended_at - job.started_at).num_milliseconds() as i32;
    let mut prompt_tokens = job.prompt_tokens;
    let mut completion_tokens = job.completion_tokens;
    let mut usage_source = job.usage_source;

    if job.has_span && usage_source.is_none() {
        prompt_tokens = job
            .input_text
            .as_deref()
            .map(|text| estimate_tokens(&job.model, text));
        completion_tokens = job
            .output_text
            .as_deref()
            .map(|text| estimate_tokens(&job.model, text));
        if prompt_tokens.is_some() || completion_tokens.is_some() {
            usage_source = Some("estimated");
        }
    }

    let total_tokens = match (prompt_tokens, completion_tokens) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    };
    let cost = lookup_cost(pool, job, prompt_tokens, completion_tokens).await?;

    let mut tx = pool.begin().await?;
    if job.agent_run {
        sqlx::query(
            "SELECT id FROM trace_run WHERE id=$1 AND project_id=$2 AND is_agent=true FOR UPDATE",
        )
        .bind(job.run_id)
        .bind(job.project_id)
        .fetch_one(&mut *tx)
        .await?;
        let pending: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM trace_span WHERE id=$1 AND run_id=$2 AND status='running')")
            .bind(job.span_id).bind(job.run_id).fetch_one(&mut *tx).await?;
        if !pending {
            return tx.commit().await;
        }
    } else {
        sqlx::query!(
        r#"INSERT INTO trace_run
             (id, project_id, name, status, error_code, input_preview, output_preview,
              total_tokens, cost, usage_source, latency_ms, started_at, ended_at)
           VALUES ($1,$2,$3,$4::text::trace_status,$5,$6,$7,$8,($9::float8)::numeric,$10::text::usage_source,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             status = EXCLUDED.status,
             error_code = EXCLUDED.error_code,
             input_preview = EXCLUDED.input_preview,
             output_preview = EXCLUDED.output_preview,
             total_tokens = EXCLUDED.total_tokens,
             cost = EXCLUDED.cost,
             usage_source = EXCLUDED.usage_source,
             latency_ms = EXCLUDED.latency_ms,
             ended_at = EXCLUDED.ended_at"#,
        job.run_id,
        job.project_id,
        job.model,
        job.status,
        job.error_code,
        input_preview,
        output_preview,
        total_tokens,
        cost,
        usage_source,
        latency,
        job.started_at,
        job.ended_at,
    )
    .execute(&mut *tx)
    .await?;
    }
    if job.has_span {
        sqlx::query!(
            r#"INSERT INTO trace_span
                 (id, run_id, type, name, model, provider, input_preview, output_preview,
                  prompt_tokens, completion_tokens, usage_source, latency_ms, status, error_code, error,
                  cost, started_at, ended_at)
               VALUES ($1,$2,'llm',$3,$4,$5,$6,$7,$8,$9,$10::text::usage_source,$11,$12::text::trace_status,$13,$14,($15::float8)::numeric,$16,$17)
               ON CONFLICT (id) DO UPDATE SET
                 name=EXCLUDED.name, model=EXCLUDED.model, provider=EXCLUDED.provider,
                 input_preview=EXCLUDED.input_preview, output_preview=EXCLUDED.output_preview,
                 prompt_tokens=EXCLUDED.prompt_tokens, completion_tokens=EXCLUDED.completion_tokens,
                 usage_source=EXCLUDED.usage_source, latency_ms=EXCLUDED.latency_ms,
                 status=EXCLUDED.status, error_code=EXCLUDED.error_code, error=EXCLUDED.error,
                 cost=EXCLUDED.cost, started_at=EXCLUDED.started_at, ended_at=EXCLUDED.ended_at"#,
            job.span_id,
            job.run_id,
            job.model,
            job.model,
            job.provider,
            input_preview,
            output_preview,
            prompt_tokens,
            completion_tokens,
            usage_source,
            latency,
            job.status,
            job.error_code,
            job.error,
            cost,
            job.started_at,
            job.ended_at,
        )
        .execute(&mut *tx)
        .await?;

        // TraceEvent 挂在 llm Span 下 (schema 只允许 event→span)。
        for ev in &job.events {
            sqlx::query!(
                r#"INSERT INTO trace_event (id, span_id, type, payload, created_at)
                   VALUES ($1,$2,$3::text::trace_event_type,$4,$5)"#,
                Uuid::new_v4(),
                job.span_id,
                ev.typ,
                ev.payload,
                ev.at,
            )
            .execute(&mut *tx)
            .await?;
        }
    }

    if job.agent_run {
        sqlx::query("UPDATE trace_run SET total_tokens=a.tokens, cost=a.cost, usage_source=a.source::text::usage_source FROM (SELECT sum(COALESCE(prompt_tokens,0)+COALESCE(completion_tokens,0))::int AS tokens, CASE WHEN bool_or(cost IS NULL) THEN NULL ELSE sum(cost) END AS cost, CASE WHEN bool_or(usage_source='estimated') THEN 'estimated' WHEN bool_or(usage_source='provider') THEN 'provider' ELSE NULL END AS source FROM trace_span WHERE run_id=$1 AND type='llm') a WHERE id=$1")
            .bind(job.run_id).execute(&mut *tx).await?;
    }
    tx.commit().await
}

async fn lookup_cost(
    pool: &PgPool,
    job: &TraceJob,
    prompt_tokens: Option<i32>,
    completion_tokens: Option<i32>,
) -> Result<Option<f64>, sqlx::Error> {
    let Some(prompt_tokens) = prompt_tokens else {
        return Ok(None);
    };
    let completion_tokens = completion_tokens.unwrap_or(0);
    let row = sqlx::query!(
        r#"SELECT input_price::float8 as "input_price!", output_price::float8 as "output_price!"
           FROM model_pricing
           WHERE provider = $1 AND model = $2 AND effective_from <= $3
           ORDER BY effective_from DESC
           LIMIT 1"#,
        job.provider,
        job.model,
        job.started_at,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row
        .map(|r| prompt_tokens as f64 * r.input_price + completion_tokens as f64 * r.output_price))
}

/// 从请求体提取输入文本 (messages 拼接), 供 preview / token 估算。
pub fn extract_input(parsed: &serde_json::Value) -> Option<String> {
    let msgs = parsed.get("messages")?.as_array()?;
    let mut s = String::new();
    for m in msgs {
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let content = match m.get("content") {
            Some(serde_json::Value::String(t)) => t.clone(),
            Some(v) => v.to_string(), // 多模态/数组: 原样 JSON
            None => String::new(),
        };
        s.push_str(role);
        s.push_str(": ");
        s.push_str(&content);
        s.push('\n');
    }
    Some(s)
}

/// 从非流式响应体提取输出文本 (choices[].message.content 拼接)。
pub fn extract_output_nonstream(resp: &serde_json::Value) -> Option<String> {
    let choices = resp.get("choices")?.as_array()?;
    let out: String = choices
        .iter()
        .filter_map(|c| {
            c.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|v| v.as_str())
        })
        .collect();
    Some(out)
}

pub fn extract_usage(resp: &serde_json::Value) -> (Option<i32>, Option<i32>) {
    let usage = match resp.get("usage") {
        Some(v) => v,
        None => return (None, None),
    };
    let prompt = usage
        .get("prompt_tokens")
        .and_then(serde_json::Value::as_i64)
        .and_then(|v| i32::try_from(v).ok());
    let completion = usage
        .get("completion_tokens")
        .and_then(serde_json::Value::as_i64)
        .and_then(|v| i32::try_from(v).ok());
    (prompt, completion)
}

fn estimate_tokens(model: &str, text: &str) -> i32 {
    let len = tiktoken_rs::bpe_for_model(model)
        .unwrap_or_else(|_| tiktoken_rs::cl100k_base_singleton())
        .encode_ordinary(text)
        .len();
    i32::try_from(len).unwrap_or(i32::MAX)
}

pub fn sanitize_text(s: &str) -> String {
    sanitize(s)
}

/// 脱敏: mask 常见密钥/凭据 (§3.1), 避免敏感串进 preview。
fn sanitize(s: &str) -> String {
    use std::sync::OnceLock;
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(
            r#"(?i)(sk-[A-Za-z0-9_\-]{8,}|bearer\s+[A-Za-z0-9._\-]+|(api[-_]?key|authorization|password|secret|token)\s*["':=]+\s*[A-Za-z0-9._\-]+)"#,
        )
        .unwrap()
    });
    re.replace_all(s, "***").into_owned()
}

/// 截断成 preview: 超 MAX_PREVIEW 字符则截断并标记。
fn preview(s: &str) -> String {
    let n = s.chars().count();
    if n <= MAX_PREVIEW {
        return s.to_string();
    }
    let head: String = s.chars().take(MAX_PREVIEW).collect();
    format!("{head}…[truncated {} chars]", n - MAX_PREVIEW)
}
