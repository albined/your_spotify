#!/bin/sh
# Runs the server tests against a MongoDB container that exists only for the
# run, so they can never touch a database that holds real listening history.
# Arguments replace the list of test files: sh scripts/test-local.sh test/x.test.cjs
set -eu

cd "$(dirname "$0")/.."
name="your_spotify_test_$$"
# mongod needs far more open files than Docker's default allows.
docker run -d --rm --name "$name" --ulimit nofile=64000:64000 \
  -p 127.0.0.1::27017 mongo:6 >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1' EXIT INT TERM

until docker exec "$name" mongosh --quiet --eval 'db.adminCommand({ ping: 1 })' \
  >/dev/null 2>&1; do
  sleep 0.5
done
uri="mongodb://$(docker port "$name" 27017/tcp | head -n 1)"
export TIMELINE_TEST_MONGO_URI="$uri"
# The backup test restores a real archive, which needs MongoDB Database Tools.
if command -v mongodump >/dev/null && command -v mongorestore >/dev/null; then
  export BACKUP_TEST_MONGO_URI="$uri"
fi

if [ "$#" -eq 0 ]; then set -- test/*.test.cjs; fi
node --test --test-concurrency=1 "$@"
