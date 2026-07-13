"""End-to-end smoke check against the deployed backend.

Posts one label image with matching application data to POST /verify and
exits non-zero unless the response is 2xx. With no --image argument it
generates a synthetic sample label, so no local files are required.
"""

import argparse
import json
import mimetypes
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sample_label import SAMPLE_APPLICATION_DATA, make_sample_label_jpeg

DEFAULT_URL = "https://ttb-label-verification-backend.onrender.com"


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-check the deployed /verify endpoint.")
    parser.add_argument("--url", default=DEFAULT_URL, help="Backend base URL.")
    parser.add_argument(
        "--image",
        default=None,
        help="Optional local label image; defaults to a generated sample label.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=90.0,
        help="Request timeout; generous by default to survive Render cold starts.",
    )
    args = parser.parse_args()

    if args.image:
        image_path = Path(args.image)
        image_bytes = image_path.read_bytes()
        file_name = image_path.name
        mime_type = mimetypes.guess_type(file_name)[0] or "image/jpeg"
    else:
        image_bytes = make_sample_label_jpeg()
        file_name = "sample-label.jpg"
        mime_type = "image/jpeg"

    verify_url = f"{args.url.rstrip('/')}/verify"
    print(f"POST {verify_url} ({file_name}, {len(image_bytes)} bytes)")

    start_time = time.perf_counter()
    response = httpx.post(
        verify_url,
        files={"image": (file_name, image_bytes, mime_type)},
        data={"application_data": json.dumps(SAMPLE_APPLICATION_DATA)},
        timeout=args.timeout_seconds,
    )
    elapsed_seconds = time.perf_counter() - start_time

    if not response.is_success:
        print(f"SMOKE FAIL: HTTP {response.status_code} in {elapsed_seconds:.1f}s")
        print(response.text)
        raise SystemExit(1)

    result = response.json()
    print(f"SMOKE PASS: HTTP {response.status_code} in {elapsed_seconds:.1f}s")
    print(f"overall_verdict={result['overall_verdict']} server_latency_ms={result['latency_ms']}")


if __name__ == "__main__":
    main()
