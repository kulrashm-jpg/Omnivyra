# omnivyra-telemetry relay: Vector, pinned by version and digest-free tag (official image).
FROM timberio/vector:0.46.1-alpine
COPY vector.toml /etc/vector/vector.toml
# Railway injects PORT; vector.toml binds the Vercel drain receiver to it.
ENTRYPOINT ["/usr/local/bin/vector", "--config", "/etc/vector/vector.toml"]
