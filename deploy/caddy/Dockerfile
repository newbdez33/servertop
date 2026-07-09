# Caddy with a DNS provider module for Let's Encrypt DNS-01 challenges —
# gets a real certificate WITHOUT exposing the server to the internet.
#
# Pick your DNS provider with the build arg (module list: https://github.com/caddy-dns):
#   cloudflare | alidns | dnspod | tencentcloud | route53 | duckdns | ...
ARG CADDY_VERSION=2

FROM caddy:${CADDY_VERSION}-builder AS builder
ARG DNS_PLUGIN=cloudflare
RUN xcaddy build --with github.com/caddy-dns/${DNS_PLUGIN}

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
