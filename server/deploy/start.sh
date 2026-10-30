#!/bin/sh
# Entrypoint for the bundled image: when MONGODB_URI is not given, run MongoDB inside this container
# (data in /data/db: mount a volume there) and point the API at it. With MONGODB_URI set it is just the API.
set -eu

if [ -z "${MONGODB_URI:-}" ]; then
  mkdir -p /data/db
  # Small instances: keep the WiredTiger cache modest so the API has memory too.
  mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27017 \
    --wiredTigerCacheSizeGB "${MONGO_CACHE_GB:-0.5}" --quiet --logpath /data/db/mongod.log --logappend &
  MONGO_PID=$!
  i=0
  until mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' mongodb://127.0.0.1:27017 >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 60 ] || ! kill -0 "$MONGO_PID" 2>/dev/null; then
      echo '{"level":"ERROR","msg":"mongod did not start"}'
      tail -n 40 /data/db/mongod.log 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done
  export MONGODB_URI="mongodb://127.0.0.1:27017"
  echo '{"level":"INFO","msg":"embedded mongod ready","dbpath":"/data/db"}'

  # Stop both cleanly: API first (drains requests), then mongod (flushes journal).
  /server &
  API_PID=$!
  trap 'kill -TERM "$API_PID" 2>/dev/null; wait "$API_PID"; kill -TERM "$MONGO_PID"; wait "$MONGO_PID"; exit 0' TERM INT
  wait "$API_PID"
  status=$?
  kill -TERM "$MONGO_PID" 2>/dev/null || true
  wait "$MONGO_PID" || true
  exit "$status"
fi

exec /server
