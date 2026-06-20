import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.vision import VisionService, VisionServiceError


# Run VisionService manually against one local sample image.
def main() -> None:
    parser = argparse.ArgumentParser(description="Extract label fields from a sample image.")
    parser.add_argument("image_path", help="Path to a local label image.")
    parser.add_argument(
        "--mime-type",
        default="image/jpeg",
        help="Input image MIME type; output sent to the model is always optimized JPEG.",
    )
    parser.add_argument("--model", default=None, help="Optional model override.")
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=4.0,
        help="Google AI request timeout in seconds.",
    )
    args = parser.parse_args()

    load_dotenv()

    image_path = Path(args.image_path)
    image_bytes = image_path.read_bytes()

    try:
        result = VisionService(
            model=args.model,
            timeout_seconds=args.timeout_seconds,
        ).extract_label(image_bytes, args.mime_type)
    except VisionServiceError as exc:
        raise SystemExit(f"Extraction failed: {exc}") from exc

    print(result.model_dump_json(indent=4))


if __name__ == "__main__":
    main()
