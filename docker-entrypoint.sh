#!/bin/sh
# Override the container's DNS resolvers before starting the worker.
# Some VPS / datacenter default resolvers time out or hand back unreachable
# IPs for web.whatsapp.com, which surfaces as net::ERR_TIMED_OUT in puppeteer.
# Both Node (getaddrinfo) and Chromium read /etc/resolv.conf, so this covers
# the worker's fetch calls and the WhatsApp Web browser session.
# Override the list with DNS_SERVERS="ip1 ip2", or DNS_SERVERS="" to skip.
DNS_SERVERS="${DNS_SERVERS-1.1.1.1 8.8.8.8 1.0.0.1}"

if [ -n "$DNS_SERVERS" ]; then
  {
    for ip in $DNS_SERVERS; do
      printf 'nameserver %s\n' "$ip"
    done
  } > /etc/resolv.conf 2>/dev/null \
    && echo "DNS resolvers set to: $DNS_SERVERS" \
    || echo "WARNING: could not write /etc/resolv.conf (read-only or non-root) — keeping container default DNS"
fi

exec "$@"
