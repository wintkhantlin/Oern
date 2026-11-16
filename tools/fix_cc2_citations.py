from __future__ import annotations

import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"


def fix_xml(data: bytes, lock_citation_fields: bool) -> tuple[bytes, int, int]:
    parser = etree.XMLParser(remove_blank_text=False, resolve_entities=False)
    root = etree.fromstring(data, parser)
    replacements = 0
    locks = 0

    # Word caches the visible result of citation and bibliography fields in w:t.
    # Keep those fields intact but normalize the displayed author-date text.
    for text in root.iter(f"{W}t"):
        if text.text:
            updated, count = re.subn(r"n\.d\.-[a-z](?=\))", "n.d.", text.text)
            if count:
                text.text = updated
                replacements += count

    if lock_citation_fields:
        in_target_field = False
        depth = 0
        for node in root.iter():
            if node.tag == f"{W}fldChar":
                kind = node.get(f"{W}fldCharType")
                if kind == "begin":
                    depth += 1
                    in_target_field = False
                elif kind == "end":
                    depth = max(0, depth - 1)
                    if depth == 0:
                        in_target_field = False
            elif node.tag == f"{W}instrText" and depth and node.text:
                command = node.text.strip().upper()
                if command.startswith("CITATION ") or command.startswith("BIBLIOGRAPHY"):
                    in_target_field = True
                    parent = node.getparent()
                    paragraph = parent
                    while paragraph is not None and paragraph.tag != f"{W}p":
                        paragraph = paragraph.getparent()
                    if paragraph is not None:
                        begins = paragraph.xpath('.//w:fldChar[@w:fldCharType="begin"]', namespaces={"w": W_NS})
                        for begin in begins:
                            if begin.get(f"{W}fldLock") != "true":
                                begin.set(f"{W}fldLock", "true")
                                locks += 1

    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True), replacements, locks


def main() -> None:
    path = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as td:
        temp = Path(td) / path.name
        replacements = 0
        locks = 0
        with zipfile.ZipFile(path, "r") as source, zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as target:
            for item in source.infolist():
                data = source.read(item.filename)
                if item.filename.endswith(".xml"):
                    try:
                        data, changed, locked = fix_xml(data, item.filename == "word/document.xml")
                        replacements += changed
                        locks += locked
                    except etree.XMLSyntaxError:
                        pass
                target.writestr(item, data)
        shutil.copy2(temp, path)
    print(f"normalized={replacements} locked_fields={locks} output={path}")


if __name__ == "__main__":
    main()
