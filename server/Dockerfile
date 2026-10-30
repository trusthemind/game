# Ashfall backend with MongoDB in the same container. Build context is this directory (server/).
# Without MONGODB_URI the entrypoint starts mongod on 127.0.0.1 (data in /data/db: mount a volume there);
# with MONGODB_URI set it only runs the API. Dockerfile.slim is the API-only distroless image.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM mongo:8.0
COPY --from=build /out/server /server
COPY deploy/start.sh /start.sh
# MongoDB 8 crashes on recent kernels without this (SERVER-121912).
ENV GLIBC_TUNABLES=glibc.pthread.rseq=1 \
    PORT=8080
EXPOSE 8080
VOLUME ["/data/db"]
ENTRYPOINT ["/start.sh"]
