from __future__ import annotations

import os
import re
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


DOCX_PATH = Path("/Users/happer/DSA/Wint Khant Lin DSA 2.docx")


CASE_BY_OLD_ID = {
    1: "Display empty inventory",
    2: "Add and display a book",
    3: "Reject duplicate book ID",
    4: "Reject negative stock quantity",
    5: "Reject empty title",
    6: "Handle non-numeric price input",
    7: "Reject infinite price",
    8: "Reject invalid menu input",
    9: "Update book price and stock",
    10: "Reject invalid update values",
    11: "Update unknown Book ID",
    12: "Delete book and repeat delete",
    14: "Undo two updates in LIFO order",
    15: "Undo when Stack is empty",
    16: "Undo replenishment restock",
    17: "Undo after book is deleted",
    18: "Process two requests in FIFO order",
    19: "Reject request for unknown Book",
    21: "Process with empty Queue",
    23: "Check Queue capacity of ten",
    24: "Sort books by title with Merge Sort",
    25: "Sort books by price with Merge Sort",
    27: "Reject invalid sort key",
    29: "Find warehouse-to-Botataung route",
    32: "Handle unknown graph location",
    33: "Exit program",
}


def set_cell_text(cell, text: str, *, bold: bool = False, color: str = "000000") -> None:
    cell.text = ""
    paragraph = cell.paragraphs[0]
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.line_spacing = 1
    run = paragraph.add_run(text)
    run.bold = bold
    run.font.name = "Verdana"
    run.font.size = Pt(10.5)
    run.font.color.rgb = RGBColor.from_string(color)
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.rFonts
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), "Verdana")
    rfonts.set(qn("w:hAnsi"), "Verdana")


def shade_cell(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top: int = 90, start: int = 110, bottom: int = 90, end: int = 110) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for edge, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{edge}"))
        if node is None:
            node = OxmlElement(f"w:{edge}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_width(cell, width_inches: float) -> None:
    width = Inches(width_inches)
    cell.width = width
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(width.twips)))
    tc_w.set(qn("w:type"), "dxa")


def set_table_borders(table, color: str = "D9D9D9", size: str = "6") -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        border = borders.find(tag)
        if border is None:
            border = OxmlElement(f"w:{edge}")
            borders.append(border)
        border.set(qn("w:val"), "single")
        border.set(qn("w:sz"), size)
        border.set(qn("w:space"), "0")
        border.set(qn("w:color"), color)


def set_row_flags(row, *, repeat_header: bool = False, keep_together: bool = True) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    if repeat_header:
        header = OxmlElement("w:tblHeader")
        header.set(qn("w:val"), "true")
        tr_pr.append(header)
    if keep_together:
        cant_split = OxmlElement("w:cantSplit")
        tr_pr.append(cant_split)


def replace_in_runs(paragraph, old: str, new: str) -> bool:
    changed = False
    for run in paragraph.runs:
        if old in run.text:
            run.text = run.text.replace(old, new)
            changed = True
    return changed


def remove_existing_summary_table(doc: Document) -> None:
    for table in list(doc.tables):
        if not table.rows or len(table.rows[0].cells) != 3:
            continue
        headers = [cell.text.strip() for cell in table.rows[0].cells]
        if headers == ["Test", "Case", "Status"]:
            table._element.getparent().remove(table._element)


def main() -> None:
    doc = Document(DOCX_PATH)
    remove_existing_summary_table(doc)

    manual_heading_idx = next(
        i for i, p in enumerate(doc.paragraphs) if p.text.strip() == "Manual Test Cases"
    )
    result_heading_idx = next(
        i for i, p in enumerate(doc.paragraphs) if p.text.strip() == "Manual Test Result"
    )

    intro = doc.paragraphs[manual_heading_idx + 1]
    test_paragraphs = []
    for paragraph in doc.paragraphs[manual_heading_idx + 2 : result_heading_idx]:
        match = re.search(r"\bT(\d{2})\b", paragraph.text)
        if match:
            test_paragraphs.append((paragraph, int(match.group(1))))

    old_ids = [old_id for _, old_id in test_paragraphs]
    missing_names = [old_id for old_id in old_ids if old_id not in CASE_BY_OLD_ID]
    if missing_names:
        raise RuntimeError(f"No summary case name for remaining test IDs: {missing_names}")

    total = len(test_paragraphs)
    mapping = {}
    for new_id, (paragraph, old_id) in enumerate(test_paragraphs, start=1):
        old_token = f"T{old_id:02d}"
        new_token = f"T{new_id:02d}"
        if old_token != new_token and not replace_in_runs(paragraph, old_token, new_token):
            raise RuntimeError(f"Could not replace {old_token} in test paragraph")
        mapping[old_id] = new_id

    intro_text = intro.text
    range_match = re.search(r"T01 to T\d{2}", intro_text)
    if not range_match:
        raise RuntimeError("Could not find test ID range in Manual Test Cases introduction")
    replace_in_runs(intro, range_match.group(0), f"T01 to T{total:02d}")

    result_paragraph = doc.paragraphs[result_heading_idx + 1]
    result_match = re.search(r"\b\d+ passed cases\b", result_paragraph.text)
    if not result_match:
        raise RuntimeError("Could not find passed-case total in Manual Test Result")
    replace_in_runs(result_paragraph, result_match.group(0), f"{total} passed cases")

    table = doc.add_table(rows=1, cols=3)
    table.autofit = False
    table.alignment = 1
    table.allow_autofit = False
    set_table_borders(table)

    widths = (0.75, 5.30, 0.95)
    header = table.rows[0]
    set_row_flags(header, repeat_header=True)
    for index, (cell, label) in enumerate(zip(header.cells, ("Test", "Case", "Status"))):
        set_cell_text(cell, label, bold=True, color="FFFFFF")
        shade_cell(cell, "1F4E78")
        set_cell_margins(cell)
        set_cell_width(cell, widths[index])
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    for new_id, (_, old_id) in enumerate(test_paragraphs, start=1):
        row = table.add_row()
        set_row_flags(row)
        values = (f"T{new_id:02d}", CASE_BY_OLD_ID[old_id], "Pass")
        for index, (cell, value) in enumerate(zip(row.cells, values)):
            text_color = "2E7D32" if index == 2 else "000000"
            set_cell_text(cell, value, bold=(index in (0, 2)), color=text_color)
            if new_id % 2 == 0:
                shade_cell(cell, "EAF2F8")
            set_cell_margins(cell)
            set_cell_width(cell, widths[index])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell.paragraphs[0].alignment = (
                WD_ALIGN_PARAGRAPH.LEFT if index == 1 else WD_ALIGN_PARAGRAPH.CENTER
            )

    intro._p.addnext(table._tbl)

    settings = doc.settings._element
    update_fields = settings.find(qn("w:updateFields"))
    if update_fields is None:
        update_fields = OxmlElement("w:updateFields")
        settings.append(update_fields)
    update_fields.set(qn("w:val"), "true")

    temp_path = DOCX_PATH.with_name(f".{DOCX_PATH.stem}.codex-updating.docx")
    doc.save(temp_path)
    os.replace(temp_path, DOCX_PATH)

    print(f"Updated {DOCX_PATH}")
    print(f"Remaining tests: {total}")
    print("Renumbered IDs:")
    for old_id, new_id in mapping.items():
        print(f"  T{old_id:02d} -> T{new_id:02d}")


if __name__ == "__main__":
    main()
