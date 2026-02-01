#!/usr/bin/env python3
"""
localhost_port_scanner.py

Fast, dependency-free (stdlib only) localhost port scanner for HTTP/HTTPS services.

Features:
- Interactive setup wizard (--interactive or no args)
- Async scanner (efficient vs threads)
- Live logging / progress in terminal (what it's doing right now)
- Ignore status code classes (2xx/3xx/4xx) and/or specific codes
- Match required content in response (substring or regex) in headers/body
- Multiple paths to probe (e.g., /, /api/health, /healthz)
- Output: pretty terminal + optional JSON/CSV
- QoL: presets (dev/common/full), exclusions, retries, max-bytes, scheme order

Counts a port as “has content” if it speaks HTTP (any status) AND passes your filters.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import signal
import sys
import time
from dataclasses import asdict, dataclass
from typing import Iterable, Optional, Sequence, Tuple


@dataclass
class Hit:
    port: int
    scheme: str                 # "http" or "https"
    path: str
    status: Optional[int]       # parsed HTTP status code
    reason: str                 # parsed reason phrase (best-effort)
    matched: bool               # whether content match requirement passed
    sample: str                 # short snippet of body (best-effort)


# ----------------------------
# Helpers: parsing and filters
# ----------------------------

_HTTP_STATUS_RE = re.compile(r"^HTTP/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$", re.IGNORECASE)

def parse_http_response(raw: bytes) -> Tuple[Optional[int], str, bytes, bytes]:
    """
    Returns (status, reason, headers_bytes, body_bytes)
    If it doesn't look like HTTP, status=None.
    """
    # Normalize decoding boundaries by searching raw bytes for header/body split
    sep = b"\r\n\r\n"
    head, body = (raw.split(sep, 1) + [b""])[:2] if sep in raw else (raw, b"")
    head_lines = head.split(b"\r\n")
    if not head_lines:
        return None, "", head, body

    try:
        first = head_lines[0].decode("latin-1", "replace")
    except Exception:
        return None, "", head, body

    m = _HTTP_STATUS_RE.match(first.strip())
    if not m:
        return None, "", head, body

    status = int(m.group(1))
    reason = (m.group(2) or "").strip()
    return status, reason, head, body


def status_ignored(
    status: Optional[int],
    ignore_classes: set[int],
    ignore_codes: set[int],
) -> bool:
    if status is None:
        return False
    if status in ignore_codes:
        return True
    cls = status // 100
    return cls in ignore_classes


def content_matches(
    haystack: str,
    match_substring: Optional[str],
    match_regex: Optional[re.Pattern[str]],
) -> bool:
    if match_substring is not None:
        return match_substring in haystack
    if match_regex is not None:
        return bool(match_regex.search(haystack))
    return True  # no requirement => passes


def chunked_ranges_from_preset(preset: str) -> list[Tuple[int, int]]:
    preset = preset.lower().strip()
    if preset == "dev":
        # Common dev ports and ranges people actually use.
        return [
            (3000, 3999),
            (4200, 4299),
            (5000, 5999),
            (8000, 8999),
            (9000, 9999),
            (10000, 10100),
        ]
    if preset == "common":
        # “I just want likely stuff”
        common_ports = [
            80, 443, 3000, 3001, 3002, 3003, 4000, 4200, 5000, 5173, 7000, 7070,
            8000, 8080, 8081, 8088, 8443, 8888, 9000, 9090, 10000
        ]
        return [(p, p) for p in common_ports]
    if preset == "full":
        return [(1, 65535)]
    # fallback
    return [(1, 65535)]


def iter_ports(ranges: Sequence[Tuple[int, int]], exclude: set[int]) -> list[int]:
    ports: list[int] = []
    for a, b in ranges:
        a = max(1, int(a))
        b = min(65535, int(b))
        if b < a:
            a, b = b, a
        for p in range(a, b + 1):
            if p not in exclude:
                ports.append(p)
    return ports


# ----------------------------
# Networking: async probe
# ----------------------------

async def probe_once(
    host: str,
    port: int,
    scheme: str,
    path: str,
    timeout: float,
    max_bytes: int,
) -> Optional[Tuple[Optional[int], str, str, str]]:
    """
    Returns (status, reason, headers_text, body_text_snippet) if HTTP-like response; else None.
    """
    ssl_ctx = None
    if scheme == "https":
        import ssl
        ssl_ctx = ssl.create_default_context()
        # dev certs are often self-signed; don't bail scanning because of cert chain
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"User-Agent: localhost-port-scanner/2.0\r\n"
        f"Accept: */*\r\n"
        f"Connection: close\r\n\r\n"
    ).encode("utf-8", "ignore")

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host=host, port=port, ssl=ssl_ctx),
            timeout=timeout,
        )
        writer.write(req)
        await asyncio.wait_for(writer.drain(), timeout=timeout)

        raw = b""
        # Read up to max_bytes (enough to parse headers + some body)
        while len(raw) < max_bytes:
            chunk = await asyncio.wait_for(reader.read(2048), timeout=timeout)
            if not chunk:
                break
            raw += chunk

        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

        if not raw:
            return None

        status, reason, headers_b, body_b = parse_http_response(raw)
        if status is None:
            return None

        headers_text = headers_b.decode("latin-1", "replace")
        body_text = body_b.decode("utf-8", "replace")

        # small snippet for display
        snippet = " ".join(body_text.strip().split())
        snippet = snippet[:160]

        return status, reason, headers_text, snippet

    except Exception:
        return None


async def probe_port(
    host: str,
    port: int,
    schemes: Sequence[str],
    paths: Sequence[str],
    timeout: float,
    max_bytes: int,
    retries: int,
) -> list[Tuple[str, str, Optional[int], str, str, str]]:
    """
    Try schemes and paths. Returns list of successful HTTP hits for this port:
    (scheme, path, status, reason, headers_text, body_snippet)
    """
    results = []
    for scheme in schemes:
        for path in paths:
            attempt = 0
            while True:
                resp = await probe_once(host, port, scheme, path, timeout, max_bytes)
                if resp is not None:
                    status, reason, headers_text, snippet = resp
                    results.append((scheme, path, status, reason, headers_text, snippet))
                    break
                attempt += 1
                if attempt > retries:
                    break
    return results


# ----------------------------
# Live progress/logging
# ----------------------------

class LiveState:
    def __init__(self, total: int, verbose: bool, log_every: float):
        self.total = total
        self.verbose = verbose
        self.log_every = log_every
        self.start = time.time()

        self.scanned = 0
        self.http_hits = 0
        self.kept_hits = 0
        self.current = "initializing"
        self._stop = False
        self._last_print = 0.0

    def stop(self) -> None:
        self._stop = True

    def set_current(self, s: str) -> None:
        self.current = s

    def bump_scanned(self, n: int = 1) -> None:
        self.scanned += n

    def bump_http_hits(self, n: int = 1) -> None:
        self.http_hits += n

    def bump_kept_hits(self, n: int = 1) -> None:
        self.kept_hits += n

    def line(self) -> str:
        elapsed = time.time() - self.start
        rate = self.scanned / elapsed if elapsed > 0 else 0.0
        pct = (self.scanned / self.total * 100.0) if self.total else 0.0
        return (
            f"[{pct:6.2f}%] scanned {self.scanned}/{self.total} "
            f"({rate:,.0f}/s) | http:{self.http_hits} kept:{self.kept_hits} | "
            f"now: {self.current}"
        )

    async def printer(self) -> None:
        while not self._stop:
            now = time.time()
            if now - self._last_print >= self.log_every:
                self._last_print = now
                print(self.line(), end="\r", flush=True)
            await asyncio.sleep(0.05)


# ----------------------------
# Interactive wizard
# ----------------------------

def wizard() -> argparse.Namespace:
    print("\nLocalhost Port Scanner — interactive setup\n")

    def ask(prompt: str, default: str) -> str:
        s = input(f"{prompt} [{default}]: ").strip()
        return s if s else default

    preset = ask("Preset (dev/common/full/custom)", "dev").lower()
    host = ask("Host", "127.0.0.1")
    timeout = float(ask("Timeout seconds per probe", "0.35"))
    concurrency = int(ask("Concurrency (higher=faster, too high can be noisy)", "600"))
    max_bytes = int(ask("Max bytes to read per response", "8192"))
    retries = int(ask("Retries per scheme/path (0 is fine)", "0"))

    if preset == "custom":
        start = int(ask("Start port", "1"))
        end = int(ask("End port", "65535"))
        ranges = [(start, end)]
    else:
        ranges = chunked_ranges_from_preset(preset)

    scheme_order = ask("Schemes to try (comma separated: http,https)", "http,https")
    schemes = [s.strip().lower() for s in scheme_order.split(",") if s.strip() in ("http", "https")]
    if not schemes:
        schemes = ["http", "https"]

    paths_raw = ask("Paths to probe (comma separated)", "/")
    paths = [p.strip() for p in paths_raw.split(",") if p.strip()]
    if not paths:
        paths = ["/"]

    ignore_classes_raw = ask("Ignore status classes? (e.g. 2,3,4 or blank)", "")
    ignore_classes = {int(x.strip()) for x in ignore_classes_raw.split(",") if x.strip().isdigit()}

    ignore_codes_raw = ask("Ignore specific status codes? (e.g. 401,404 or blank)", "")
    ignore_codes = {int(x.strip()) for x in ignore_codes_raw.split(",") if x.strip().isdigit()}

    match_mode = ask("Require content match? (none/substr/regex)", "none").lower()
    match_substring = None
    match_regex = None
    if match_mode == "substr":
        match_substring = ask("Substring to require (case-sensitive)", "api")
    elif match_mode == "regex":
        pat = ask("Regex to require", r'"status"\s*:\s*"ok"')
        match_regex = pat

    include_headers = ask("Search match in headers too? (y/n)", "y").lower().startswith("y")
    verbose = ask("Verbose per-hit logging? (y/n)", "n").lower().startswith("y")

    out_json = ask("Write JSON output file? (blank for none)", "")
    out_csv = ask("Write CSV output file? (blank for none)", "")

    # Convert into a Namespace that matches argparse fields we use
    ns = argparse.Namespace(
        interactive=True,
        host=host,
        preset=preset,
        ranges=ranges,
        start=None,
        end=None,
        exclude_ports=set(),
        schemes=schemes,
        paths=paths,
        timeout=timeout,
        concurrency=concurrency,
        max_bytes=max_bytes,
        retries=retries,
        ignore_status_classes=ignore_classes,
        ignore_status_codes=ignore_codes,
        match_substring=match_substring,
        match_regex=match_regex,
        match_in_headers=include_headers,
        show=0,
        verbose=verbose,
        log_every=0.15,
        json_out=out_json if out_json else None,
        csv_out=out_csv if out_csv else None,
    )
    return ns


# ----------------------------
# Main runner
# ----------------------------

async def run_scan(args: argparse.Namespace) -> list[Hit]:
    # Build ranges
    if args.preset:
        ranges = chunked_ranges_from_preset(args.preset)
    else:
        ranges = [(args.start, args.end)]

    exclude = set(args.exclude_ports or [])
    ports = iter_ports(ranges, exclude)

    # Compile regex if provided
    match_regex = re.compile(args.match_regex) if args.match_regex else None

    # Cancellation support
    stop_event = asyncio.Event()

    def _handle_sigint(*_):
        stop_event.set()

    try:
        signal.signal(signal.SIGINT, _handle_sigint)
    except Exception:
        pass

    state = LiveState(total=len(ports), verbose=args.verbose, log_every=args.log_every)
    printer_task = asyncio.create_task(state.printer())

    sem = asyncio.Semaphore(args.concurrency)
    hits: list[Hit] = []
    hits_lock = asyncio.Lock()

    async def worker(port: int) -> None:
        if stop_event.is_set():
            return
        async with sem:
            state.set_current(f"probing :{port}")
            res = await probe_port(
                host=args.host,
                port=port,
                schemes=args.schemes,
                paths=args.paths,
                timeout=args.timeout,
                max_bytes=args.max_bytes,
                retries=args.retries,
            )
            state.bump_scanned(1)

            if not res:
                return

            state.bump_http_hits(1)

            # Filter each (scheme,path) hit
            for scheme, path, status, reason, headers_text, snippet in res:
                # Status filters
                if status_ignored(status, set(args.ignore_status_classes), set(args.ignore_status_codes)):
                    continue

                # Content match
                hay = ""
                if args.match_in_headers:
                    hay = headers_text + "\n\n" + snippet
                else:
                    hay = snippet
                ok = content_matches(hay, args.match_substring, match_regex)

                if not ok:
                    continue

                hit = Hit(
                    port=port,
                    scheme=scheme,
                    path=path,
                    status=status,
                    reason=reason,
                    matched=ok,
                    sample=snippet,
                )
                async with hits_lock:
                    hits.append(hit)
                    state.bump_kept_hits(1)
                    if args.verbose:
                        code = hit.status if hit.status is not None else "?"
                        print(f"\n+ hit {hit.port} {hit.scheme.upper()} {hit.path} {code} {hit.reason} | {hit.sample}")

    # Schedule tasks
    tasks = [asyncio.create_task(worker(p)) for p in ports]

    # Wait; allow early stop
    while tasks and not stop_event.is_set():
        done, pending = await asyncio.wait(tasks, timeout=0.2, return_when=asyncio.FIRST_COMPLETED)
        tasks = list(pending)

    # If stopped, cancel pending
    if stop_event.is_set():
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    state.stop()
    await asyncio.sleep(0.05)
    printer_task.cancel()
    with contextlib_suppress():
        await printer_task

    # Final newline so the carriage-return progress line doesn’t eat the summary
    print()

    hits.sort(key=lambda h: (h.port, h.scheme, h.path))
    return hits


def write_json(path: str, hits: list[Hit], meta: dict) -> None:
    payload = {"meta": meta, "hits": [asdict(h) for h in hits]}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def write_csv(path: str, hits: list[Hit]) -> None:
    fieldnames = ["port", "scheme", "path", "status", "reason", "matched", "sample"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for h in hits:
            w.writerow(asdict(h))


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Scan localhost ports for HTTP/HTTPS responders (fast, stdlib-only).")

    ap.add_argument("--interactive", action="store_true", help="Run the interactive setup wizard.")
    ap.add_argument("--host", default="127.0.0.1", help="Host to scan (default: 127.0.0.1)")

    preset = ap.add_mutually_exclusive_group()
    preset.add_argument("--preset", choices=["dev", "common", "full"], help="Preset port ranges.")
    preset.add_argument("--range", dest="range_str", help='Custom range "start-end" (e.g. 3000-3999).')

    ap.add_argument("--exclude", default="", help="Comma-separated ports to exclude (e.g. 22,25,3306)")

    ap.add_argument("--schemes", default="http,https", help="Schemes to try in order: http,https")
    ap.add_argument("--paths", default="/", help='Comma-separated paths to probe (e.g. "/,/api/health,/healthz")')

    ap.add_argument("--timeout", type=float, default=0.35, help="Per-probe timeout seconds (default: 0.35)")
    ap.add_argument("--concurrency", type=int, default=600, help="Concurrent probes (default: 600)")
    ap.add_argument("--max-bytes", type=int, default=8192, help="Max bytes to read per response (default: 8192)")
    ap.add_argument("--retries", type=int, default=0, help="Retries per scheme/path (default: 0)")

    ap.add_argument("--ignore-status-classes", default="", help="Comma classes to ignore (e.g. 2,3,4)")
    ap.add_argument("--ignore-status-codes", default="", help="Comma codes to ignore (e.g. 401,404)")

    match = ap.add_mutually_exclusive_group()
    match.add_argument("--match-substring", default=None, help="Require substring in response (case-sensitive).")
    match.add_argument("--match-regex", default=None, help="Require regex match in response.")

    ap.add_argument("--match-in-headers", action="store_true", help="Include headers in match search.")
    ap.add_argument("--verbose", action="store_true", help="Print each kept hit as it’s found.")
    ap.add_argument("--log-every", type=float, default=0.15, help="Progress refresh seconds (default: 0.15)")

    ap.add_argument("--show", type=int, default=0, help="Show first N hits (0 = show all).")
    ap.add_argument("--json-out", default=None, help="Write hits + meta to a JSON file.")
    ap.add_argument("--csv-out", default=None, help="Write hits to a CSV file.")

    ns = ap.parse_args(argv)

    # If no args besides script name, prefer interactive
    if (len(argv) == 0):
        ns.interactive = True

    if ns.interactive:
        return wizard()

    # Normalize ranges
    if ns.preset:
        ns.preset = ns.preset
        ns.start, ns.end = None, None
    else:
        if not ns.range_str:
            ns.range_str = "1-65535"
        a, b = ns.range_str.split("-", 1)
        ns.start, ns.end = int(a), int(b)
        ns.preset = None

    # Normalize excludes
    ns.exclude_ports = set()
    if ns.exclude.strip():
        for part in ns.exclude.split(","):
            part = part.strip()
            if part.isdigit():
                ns.exclude_ports.add(int(part))

    # Normalize schemes/paths
    ns.schemes = [s.strip().lower() for s in ns.schemes.split(",") if s.strip().lower() in ("http", "https")]
    if not ns.schemes:
        ns.schemes = ["http", "https"]
    ns.paths = [p.strip() for p in ns.paths.split(",") if p.strip()]
    if not ns.paths:
        ns.paths = ["/"]

    # Status ignore sets
    ns.ignore_status_classes = {int(x.strip()) for x in ns.ignore_status_classes.split(",") if x.strip().isdigit()}
    ns.ignore_status_codes = {int(x.strip()) for x in ns.ignore_status_codes.split(",") if x.strip().isdigit()}

    return ns


class contextlib_suppress:
    def __enter__(self):  # noqa
        return self
    def __exit__(self, exc_type, exc, tb):  # noqa
        return True


def main() -> None:
    args = parse_args(sys.argv[1:])

    t0 = time.time()
    try:
        hits = asyncio.run(run_scan(args))
    except KeyboardInterrupt:
        print("\nStopped.")
        return

    dur = time.time() - t0
    total = len(hits)

    # Summary
    print(f"Scan finished in {dur:.2f}s")
    print(f"HTTP/HTTPS ports that passed filters: {total}\n")

    to_show = hits if args.show == 0 else hits[: args.show]
    for h in to_show:
        code = str(h.status) if h.status is not None else "?"
        snippet = f" | {h.sample}" if h.sample else ""
        print(f"{h.port:5d}  {h.scheme.upper():5s}  {h.path:18s}  {code:>3s}  {h.reason}{snippet}")

    if args.show and total > args.show:
        print(f"\n...and {total - args.show} more")

    meta = {
        "host": args.host,
        "schemes": list(args.schemes),
        "paths": list(args.paths),
        "timeout": args.timeout,
        "concurrency": args.concurrency,
        "max_bytes": args.max_bytes,
        "retries": args.retries,
        "ignore_status_classes": sorted(list(args.ignore_status_classes)),
        "ignore_status_codes": sorted(list(args.ignore_status_codes)),
        "match_substring": args.match_substring,
        "match_regex": args.match_regex,
        "match_in_headers": bool(args.match_in_headers),
        "duration_seconds": dur,
        "hits": total,
        "timestamp_unix": time.time(),
    }

    if args.json_out:
        write_json(args.json_out, hits, meta)
        print(f"\nWrote JSON: {args.json_out}")

    if args.csv_out:
        write_csv(args.csv_out, hits)
        print(f"Wrote CSV: {args.csv_out}")


if __name__ == "__main__":
    main()
