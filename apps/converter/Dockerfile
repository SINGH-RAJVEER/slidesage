# Runtime image for the card converter. Bundle it first with
# `just converter-bundle`, which writes dist/converter.js.

from docker.io/oven/bun:1.3-distroless as converter

workdir /app

copy dist/converter.js /app/converter.js

env CARD_CONVERTER_HOST=0.0.0.0

expose 8090

entrypoint ["/usr/local/bin/bun", "/app/converter.js"]
