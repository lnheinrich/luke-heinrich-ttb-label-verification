"""Shared sample data for the live smoke and latency measurement scripts."""

import textwrap
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

STANDARD_GOVERNMENT_WARNING = (
    "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD "
    "NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF "
    "BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR "
    "ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH "
    "PROBLEMS."
)

SAMPLE_APPLICATION_DATA = {
    "brand_name": "Old Tom Distillery",
    "class_type": "Straight Bourbon Whiskey",
    "abv": "45%",
    "net_contents": "750 mL",
    "producer": "Old Tom Spirits Co.",
    "country_of_origin": "United States",
    "government_warning": STANDARD_GOVERNMENT_WARNING,
}


# Render a synthetic label image whose text matches SAMPLE_APPLICATION_DATA,
# so the scripts work end-to-end without any local image files.
def make_sample_label_jpeg() -> bytes:
    image = Image.new("RGB", (900, 1100), "white")
    draw = ImageDraw.Draw(image)

    lines = [
        ("OLD TOM DISTILLERY", 52, 80),
        ("STRAIGHT BOURBON WHISKEY", 34, 200),
        ("45% ALC./VOL. (90 PROOF)", 30, 300),
        ("750 mL", 30, 370),
        ("DISTILLED AND BOTTLED BY OLD TOM SPIRITS CO.", 22, 460),
        ("PRODUCT OF THE UNITED STATES", 22, 520),
    ]
    for text, size, top in lines:
        font = ImageFont.load_default(size=size)
        width = draw.textlength(text, font=font)
        draw.text(((900 - width) / 2, top), text, fill="black", font=font)

    warning_font = ImageFont.load_default(size=20)
    warning_top = 700
    for line in textwrap.wrap(STANDARD_GOVERNMENT_WARNING, width=72):
        draw.text((60, warning_top), line, fill="black", font=warning_font)
        warning_top += 30

    output = BytesIO()
    image.save(output, format="JPEG", quality=90)
    return output.getvalue()
