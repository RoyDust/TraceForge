FROM rust:1-bookworm
WORKDIR /app
COPY gateway/Cargo.toml gateway/Cargo.lock ./
COPY gateway/src ./src
EXPOSE 8787
CMD ["cargo", "run", "--release", "--bin", "traceforge-gateway"]
