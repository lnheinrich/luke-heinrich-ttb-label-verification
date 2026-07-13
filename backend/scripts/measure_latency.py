"""Measure single-label /verify latency percentiles against a deployed URL.

Posts label images to POST /verify sequentially and reports p50/p95 of both
the client-observed request time and the server-reported latency_ms. Pass
one or more real label image paths; with none it falls back to a generated
sample label. A warmup request absorbs Render cold starts before timing.
"""

import argparse
import json
import math
import mimetypes
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sample_label import SAMPLE_APPLICATION_DATA, make_sample_label_jpeg

DEFAULT_URL = "https://ttb-label-verification-backend.onrender.com"


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure /verify latency percentiles.")
    parser.add_argument(
        "images",
        nargs="*",
        help="Label image paths, cycled across runs; defaults to a generated sample label.",
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="Backend base URL.")
    parser.add_argument("--runs", type=int, default=15, help="Timed request count.")
    parser.add_argument("--warmup", type=int, default=1, help="Untimed warmup requests.")
    parser.add_argument("--timeout-seconds", type=float, default=90.0)
    args = parser.parse_args()

    if args.images:
        uploads = [load_image(Path(image_path)) for image_path in args.images]
    else:
        uploads = [("sample-label.jpg", make_sample_label_jpeg(), "image/jpeg")]

    verify_url = f"{args.url.rstrip('/')}/verify"
    application_data = json.dumps(SAMPLE_APPLICATION_DATA)
    total_ms_values: list[float] = []
    server_ms_values: list[int] = []
    failures = 0

    with httpx.Client(timeout=args.timeout_seconds) as client:
        for warmup_index in range(args.warmup):
            client.post(
                verify_url,
                files={"image": uploads[warmup_index % len(uploads)]},
                data={"application_data": application_data},
            )
            print(f"warmup {warmup_index + 1}/{args.warmup} done")

        for run_index in range(args.runs):
            file_name, image_bytes, mime_type = uploads[run_index % len(uploads)]
            start_time = time.perf_counter()
            response = client.post(
                verify_url,
                files={"image": (file_name, image_bytes, mime_type)},
                data={"application_data": application_data},
            )
            total_ms = (time.perf_counter() - start_time) * 1000

            if not response.is_success:
                failures += 1
                print(f"run {run_index + 1}/{args.runs} {file_name} HTTP {response.status_code} (excluded)")
                continue

            result = response.json()
            total_ms_values.append(total_ms)
            server_ms_values.append(result["latency_ms"])
            print(
                f"run {run_index + 1}/{args.runs} {file_name} "
                f"total={total_ms:.0f}ms server={result['latency_ms']}ms "
                f"verdict={result['overall_verdict']}"
            )

    if not total_ms_values:
        raise SystemExit("All runs failed; no latency data collected.")

    print(f"\n{len(total_ms_values)} successful runs, {failures} failures, against {verify_url}")
    print(f"client total ms: p50={percentile(total_ms_values, 0.50):.0f} p95={percentile(total_ms_values, 0.95):.0f}")
    print(f"server latency_ms: p50={percentile(server_ms_values, 0.50):.0f} p95={percentile(server_ms_values, 0.95):.0f}")


def load_image(image_path: Path) -> tuple[str, bytes, str]:
    mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    return (image_path.name, image_path.read_bytes(), mime_type)


# Nearest-rank percentile; well-defined for the small run counts used here.
def percentile(values: list[float] | list[int], fraction: float) -> float:
    ordered = sorted(values)
    rank = max(1, math.ceil(fraction * len(ordered)))
    return float(ordered[rank - 1])


if __name__ == "__main__":
    main()
