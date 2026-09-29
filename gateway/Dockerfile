FROM rust:1-bookworm AS builder
WORKDIR /app
COPY gateway/Cargo.toml gateway/Cargo.lock ./
COPY gateway/src ./src
COPY gateway/.sqlx ./.sqlx
ENV SQLX_OFFLINE=true
RUN cargo build --locked --release --bins

FROM debian:bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1001 --no-create-home --shell /usr/sbin/nologin traceforge
COPY --from=builder /app/target/release/traceforge-gateway /usr/local/bin/traceforge-gateway
COPY --from=builder /app/target/release/mock_upstream /usr/local/bin/mock_upstream
USER 1001:1001
EXPOSE 8787
CMD ["traceforge-gateway"]
