//! Trace 采集写库管线 (Stage 2)。
//!
//! 主转发路径只负责「组装」一次调用的 TraceJob 并 `submit`，落库交给独立 async worker：
//! 有界 channel + 单写 worker，绝不阻塞主转发 (决策 6/7)。队列满则整条丢弃。
//!
//! 当前: T1 非流式落库 (TraceRun + 1 个 llm TraceSpan)。流式细粒度事件 / usage / 成本 / 可靠性
//! 见后续切片 (T2–T6)。

use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;

use chrono::NaiveDateTime;
use sqlx::PgPool;
use tokio::sync::mpsc;
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
    pub model: String,
    pub provider: String,
    pub status: &'static str,
    pub error_code: Option<String>,
    pub error: Option<String>, // 脱敏后的错误摘要
    pub input_text: Option<String>, // 完整原文; worker 负责脱敏 + 截断成 preview
    pub output_text: Option<String>,
    pub prompt_tokens: Option<i32>,
    pub completion_tokens: Option<i32>,
    pub usage_source: Option<&'static str>,
    pub started_at: NaiveDateTime,
    pub ended_at: NaiveDateTime,
    /// false 表示鉴权/限流失败: 只写 TraceRun, 不建上游 LLM Span (§3.4)。
    pub has_span: bool,
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
        }
        // 队列满/worker 退出: 丢弃 (丢弃计数 + 重试/dead-letter 见 T6)。
    }
}

/// 启动写库 worker, 返回投递句柄。
pub fn spawn(pool: PgPool, metrics: Arc<Metrics>) -> TraceWriter {
    let (tx, mut rx) = mpsc::channel::<TraceJob>(QUEUE_CAP);
    let m = metrics.clone();
    tokio::spawn(async move {
        while let Some(job) = rx.recv().await {
            m.trace_queue_depth.fetch_sub(1, Relaxed);
            if let Err(e) = write_once(&pool, &job).await {
                // T6 再补重试 + dead-letter + 失败计数; 当前仅日志, 不影响主转发。
                eprintln!("[trace] 写库失败 run_id={} err={e}", job.run_id);
            }
        }
    });
    TraceWriter { tx, metrics }
}

/// 落库一次 Trace: TraceRun (+ 可选 llm TraceSpan), 事务保证原子。
async fn write_once(pool: &PgPool, job: &TraceJob) -> Result<(), sqlx::Error> {
    let input_preview = job.input_text.as_deref().map(|t| preview(&sanitize(t)));
    let output_preview = job.output_text.as_deref().map(|t| preview(&sanitize(t)));
    let latency = (job.ended_at - job.started_at).num_milliseconds() as i32;
    let total_tokens = match (job.prompt_tokens, job.completion_tokens) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    };

    let mut tx = pool.begin().await?;

    sqlx::query!(
        r#"INSERT INTO trace_run
             (id, project_id, name, status, error_code, input_preview, output_preview,
              total_tokens, usage_source, latency_ms, started_at, ended_at)
           VALUES ($1,$2,$3,$4::text::trace_status,$5,$6,$7,$8,$9::text::usage_source,$10,$11,$12)"#,
        job.run_id,
        job.project_id,
        job.model,
        job.status,
        job.error_code,
        input_preview,
        output_preview,
        total_tokens,
        job.usage_source,
        latency,
        job.started_at,
        job.ended_at,
    )
    .execute(&mut *tx)
    .await?;

    if job.has_span {
        sqlx::query!(
            r#"INSERT INTO trace_span
                 (id, run_id, type, name, model, provider, input_preview, output_preview,
                  prompt_tokens, completion_tokens, usage_source, latency_ms, status, error_code, error,
                  started_at, ended_at)
               VALUES ($1,$2,'llm',$3,$4,$5,$6,$7,$8,$9,$10::text::usage_source,$11,$12::text::trace_status,$13,$14,$15,$16)"#,
            job.span_id,
            job.run_id,
            job.model,
            job.model,
            job.provider,
            input_preview,
            output_preview,
            job.prompt_tokens,
            job.completion_tokens,
            job.usage_source,
            latency,
            job.status,
            job.error_code,
            job.error,
            job.started_at,
            job.ended_at,
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await
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
