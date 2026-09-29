//! Agent-owned Run lifecycle. All mutations lock the Run before touching its Spans.
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::{authenticate, err, trace, AppState};

type ApiResult = Result<Response, Response>;

fn conflict(message: &str) -> Response {
    err(
        StatusCode::CONFLICT,
        "invalid_request_error",
        "trace_conflict",
        message,
    )
}

fn database_error(error: sqlx::Error) -> Response {
    if matches!(&error, sqlx::Error::Database(e) if e.is_unique_violation()) {
        return conflict("ID 已存在；不能覆盖已有记录");
    }
    eprintln!("[trace-ingest] database operation failed: {error}");
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "api_error",
        "internal_error",
        "Trace 写入失败",
    )
}

fn validate_text(value: &str, max: usize) -> Result<(), Response> {
    if value.trim().is_empty() || value.len() > max {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "invalid_trace",
            "文本为空或超过长度限制",
        ));
    }
    Ok(())
}

fn preview(value: Option<&str>) -> Option<String> {
    value.map(|v| trace::sanitize_text(v).chars().take(2000).collect())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartRun {
    id: Uuid,
    name: String,
    input: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StartSpan {
    id: Uuid,
    parent_id: Option<Uuid>,
    name: String,
    r#type: String,
    input: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct End {
    status: String,
    output: Option<String>,
    error_code: Option<String>,
    error: Option<String>,
}

impl End {
    fn validate(&self) -> Result<(), Response> {
        if !["success", "failed", "cancelled"].contains(&self.status.as_str()) {
            return Err(err(
                StatusCode::BAD_REQUEST,
                "invalid_request_error",
                "invalid_status",
                "status 必须是 success/failed/cancelled",
            ));
        }
        if let Some(code) = &self.error_code {
            validate_text(code, 100)?;
        }
        Ok(())
    }
}

pub async fn start_run(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<StartRun>,
) -> ApiResult {
    let key = authenticate(&st, &headers, "trace_ingest")
        .await
        .map_err(|e| e.response())?;
    validate_text(&body.name, 200)?;
    sqlx::query("INSERT INTO trace_run (id, project_id, name, status, is_agent, input_preview, started_at) VALUES ($1,$2,$3,'running',true,$4,$5)")
        .bind(body.id).bind(key.project_id).bind(body.name.trim()).bind(preview(body.input.as_deref())).bind(Utc::now().naive_utc())
        .execute(&st.pool).await.map_err(database_error)?;
    Ok((StatusCode::CREATED, Json(json!({"id": body.id}))).into_response())
}

/// Shared with the Gateway reservation: a foreign/missing Run is deliberately indistinguishable.
async fn lock_run(conn: &mut PgConnection, project: Uuid, run: Uuid) -> Result<(), Response> {
    let row = sqlx::query("SELECT status::text AS status FROM trace_run WHERE id=$1 AND project_id=$2 AND is_agent=true FOR UPDATE")
        .bind(run).bind(project).fetch_optional(conn).await.map_err(database_error)?;
    let row = row.ok_or_else(|| {
        err(
            StatusCode::NOT_FOUND,
            "invalid_request_error",
            "trace_not_found",
            "Agent Run 不存在",
        )
    })?;
    if row.get::<String, _>("status") != "running" {
        return Err(conflict("Run 已结束"));
    }
    Ok(())
}

async fn check_parent(
    conn: &mut PgConnection,
    run: Uuid,
    parent: Option<Uuid>,
) -> Result<(), Response> {
    if let Some(id) = parent {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM trace_span WHERE id=$1 AND run_id=$2 AND status='running' AND type<>'llm')")
            .bind(id).bind(run).fetch_one(conn).await.map_err(database_error)?;
        if !exists {
            return Err(conflict("父 Span 必须属于同一 Run 且仍在运行"));
        }
    }
    Ok(())
}

pub async fn start_span(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(run): Path<Uuid>,
    Json(body): Json<StartSpan>,
) -> ApiResult {
    let key = authenticate(&st, &headers, "trace_ingest")
        .await
        .map_err(|e| e.response())?;
    validate_text(&body.name, 200)?;
    if !["tool", "workflow", "db", "review"].contains(&body.r#type.as_str()) {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "invalid_span_type",
            "手动 Span 仅支持 tool/workflow/db/review",
        ));
    }
    let mut tx = st.pool.begin().await.map_err(database_error)?;
    lock_run(&mut tx, key.project_id, run).await?;
    check_parent(&mut tx, run, body.parent_id).await?;
    sqlx::query("INSERT INTO trace_span (id,run_id,parent_id,type,name,input_preview,status,started_at) VALUES ($1,$2,$3,$4::text::span_type,$5,$6,'running',$7)")
        .bind(body.id).bind(run).bind(body.parent_id).bind(body.r#type).bind(body.name.trim()).bind(preview(body.input.as_deref())).bind(Utc::now().naive_utc())
        .execute(&mut *tx).await.map_err(database_error)?;
    tx.commit().await.map_err(database_error)?;
    Ok((StatusCode::CREATED, Json(json!({"id": body.id}))).into_response())
}

/// Reserve before dispatch so endSpan/endRun cannot race an in-flight model call.
pub async fn reserve_llm(
    st: &AppState,
    project: Uuid,
    run: Uuid,
    span: Uuid,
    parent: Option<Uuid>,
    model: &str,
) -> Result<(), Response> {
    let mut tx = st.pool.begin().await.map_err(database_error)?;
    lock_run(&mut tx, project, run).await?;
    check_parent(&mut tx, run, parent).await?;
    sqlx::query("INSERT INTO trace_span (id,run_id,parent_id,type,name,status,started_at) VALUES ($1,$2,$3,'llm',$4,'running',$5)")
        .bind(span).bind(run).bind(parent).bind(model).bind(Utc::now().naive_utc()).execute(&mut *tx).await.map_err(database_error)?;
    tx.commit().await.map_err(database_error)?;
    Ok(())
}

pub async fn end_span(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path((run, span)): Path<(Uuid, Uuid)>,
    Json(body): Json<End>,
) -> ApiResult {
    let key = authenticate(&st, &headers, "trace_ingest")
        .await
        .map_err(|e| e.response())?;
    body.validate()?;
    let mut tx = st.pool.begin().await.map_err(database_error)?;
    lock_run(&mut tx, key.project_id, run).await?;
    let active_children: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM trace_span WHERE parent_id=$1 AND run_id=$2 AND status='running')")
        .bind(span).bind(run).fetch_one(&mut *tx).await.map_err(database_error)?;
    if active_children {
        return Err(conflict("仍有运行中的子 Span，请等待写入完成"));
    }
    let changed = sqlx::query("UPDATE trace_span SET status=$3::text::trace_status, output_preview=$4, error_code=$5, error=$6, ended_at=$7, latency_ms=LEAST(2147483647,GREATEST(0,EXTRACT(EPOCH FROM ($7-started_at))*1000))::int WHERE id=$1 AND run_id=$2 AND type<>'llm' AND status='running'")
        .bind(span).bind(run).bind(&body.status).bind(preview(body.output.as_deref())).bind(&body.error_code).bind(preview(body.error.as_deref())).bind(Utc::now().naive_utc())
        .execute(&mut *tx).await.map_err(database_error)?;
    if changed.rows_affected() != 1 {
        return Err(conflict("Span 不存在、已结束或由网关管理"));
    }
    tx.commit().await.map_err(database_error)?;
    Ok(Json(json!({"id": span, "status": body.status})).into_response())
}

pub async fn end_run(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(run): Path<Uuid>,
    Json(body): Json<End>,
) -> ApiResult {
    let key = authenticate(&st, &headers, "trace_ingest")
        .await
        .map_err(|e| e.response())?;
    body.validate()?;
    let mut tx = st.pool.begin().await.map_err(database_error)?;
    lock_run(&mut tx, key.project_id, run).await?;
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM trace_span WHERE run_id=$1 AND status='running')",
    )
    .bind(run)
    .fetch_one(&mut *tx)
    .await
    .map_err(database_error)?;
    if active {
        return Err(conflict("仍有运行中的 Span，请等待写入完成"));
    }
    sqlx::query("UPDATE trace_run SET status=$2::text::trace_status, output_preview=$3, error_code=$4, ended_at=$5, latency_ms=LEAST(2147483647,GREATEST(0,EXTRACT(EPOCH FROM ($5-started_at))*1000))::int WHERE id=$1")
        .bind(run).bind(&body.status).bind(preview(body.output.as_deref())).bind(&body.error_code).bind(Utc::now().naive_utc()).execute(&mut *tx).await.map_err(database_error)?;
    tx.commit().await.map_err(database_error)?;
    Ok(Json(json!({"id":run, "status":body.status})).into_response())
}

pub async fn get_run(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(run): Path<Uuid>,
) -> ApiResult {
    let key = authenticate(&st, &headers, "trace_ingest")
        .await
        .map_err(|e| e.response())?;
    let result: Option<Value> = sqlx::query_scalar(r#"SELECT jsonb_build_object('id',r.id,'name',r.name,'status',r.status,'totalTokens',r.total_tokens,'cost',r.cost,'usageSource',r.usage_source,'input',r.input_preview,'output',r.output_preview,'spans',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'parentId',s.parent_id,'type',s.type,'name',s.name,'status',s.status,'model',s.model,'provider',s.provider,'cost',s.cost,'promptTokens',s.prompt_tokens,'completionTokens',s.completion_tokens,'input',s.input_preview,'output',s.output_preview) ORDER BY s.started_at,s.id) FROM trace_span s WHERE s.run_id=r.id),'[]'::jsonb)) FROM trace_run r WHERE r.id=$1 AND r.project_id=$2 AND r.is_agent=true"#)
        .bind(run).bind(key.project_id).fetch_optional(&st.pool).await.map_err(database_error)?;
    match result {
        Some(value) => Ok(Json(value).into_response()),
        None => Err(err(
            StatusCode::NOT_FOUND,
            "invalid_request_error",
            "trace_not_found",
            "Agent Run 不存在",
        )),
    }
}
