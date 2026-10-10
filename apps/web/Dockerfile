# The edge image: nginx with the built frontend baked in, so a release tag
# pins the frontend to the API it was built against. Build the frontend first
# with `just web-bundle`, which writes dist/web. The server configuration is
# mounted from infra/templates at runtime.

from docker.io/library/nginx:1.30-alpine as web

copy dist/web /usr/share/nginx/html
