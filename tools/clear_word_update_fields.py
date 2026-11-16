from __future__ import annotations

import os
import re
import zipfile
from pathlib import Path


DOCX_PATH = Path("/Users/happer/DSA/Wint Khant Lin DSA 2.docx")
TEMP_PATH = DOCX_PATH.with_name(f".{DOCX_PATH.stem}.settings-updating.docx")
SETTINGS_PART = "word/settings.xml"
with zipfile.ZipFile(DOCX_PATH, "r") as source, zipfile.ZipFile(
    TEMP_PATH, "w", compression=zipfile.ZIP_DEFLATED
) as target:
    for item in source.infolist():
        data = source.read(item.filename)
        if item.filename == SETTINGS_PART:
            data = re.sub(rb"<w:updateFields\b[^>]*/>", b"", data)
            data = re.sub(rb"<ns0:updateFields\b[^>]*/>", b"", data)
            # ElementTree may rename namespace prefixes while retaining an
            # mc:Ignorable value that mentions the old prefix names. Removing
            # that advisory attribute restores a standards-valid settings part.
            data = re.sub(rb"\s+ns1:Ignorable=\"[^\"]*\"", b"", data, count=1)
        target.writestr(item, data)

os.replace(TEMP_PATH, DOCX_PATH)
print(f"Removed automatic field-update prompt from {DOCX_PATH}")
