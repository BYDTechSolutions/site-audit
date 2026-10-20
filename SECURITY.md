# Security policy

## Reporting a vulnerability

Please email **sales.bydtech@gmail.com** with the details, instead of opening a
public issue. We will acknowledge the report and keep you posted on the fix.

## Scope

`site-audit` fetches the URL you give it, plus robots.txt, sitemaps, llms.txt,
the share image and the links on that page, and sends one request per known AI
crawler user agent to the same URL. It makes only GET and HEAD requests, never
runs the pages' scripts, and writes only the report file you ask for.

The engine refuses private, loopback, link-local and cloud-metadata addresses
unless `allowPrivate` is set, re-checks every redirect, and caps redirects,
response size, time and the number of links. The CLI sets `allowPrivate` only
when the target is `localhost`, `127.0.0.1` or `::1`. With a `resolveHost`
function (the CLI passes one), hostnames are resolved and every address is
checked; the request then resolves the name again, so DNS rebinding between the
check and the request is not prevented. If you run this engine as a service for
untrusted input, also pin resolved addresses at the network layer and rate-limit.

Reports about bypasses of the address guard are especially welcome.
