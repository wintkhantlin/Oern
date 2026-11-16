#!/usr/bin/env python3
"""Rewrite T10-T26 test descriptions in an existing DOCX in place."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from docx import Document


REWRITES = {
    "T10": (
        "For T10, invalid update values are tested. Option 3 is used to update B101 "
        "with a price of -5 and a stock quantity of 3. The program shows “Invalid "
        "values”, and option 2 confirms that B101 remains at 25000.00 MMK with stock "
        "10, so the test is passed."
    ),
    "T11": (
        "For T11, an unknown Book ID is tested. Option 3 is selected and B999 is "
        "entered. The program shows “Book not found”, so the test is passed."
    ),
    "T12": (
        "For T12, deleting a Book and repeating the delete are tested. Option 4 is "
        "used twice with B101. The first attempt shows “Book deleted successfully”, "
        "and the second attempt shows “Book not found”, so the test is passed."
    ),
    "T13": (
        "For T13, two updates are undone to check the LIFO order. After two updates "
        "are completed, option 6 and option 2 are used twice. The first undo returns "
        "the price to 30000.00 MMK with stock 15, and the second undo returns it to "
        "25000.00 MMK with stock 10, so the test is passed."
    ),
    "T14": (
        "For T14, Undo is tested when the Stack is empty. Option 6 is selected when no "
        "update is saved, and the program shows “Nothing to undo”, so the test is passed."
    ),
    "T15": (
        "For T15, Undo is tested after a replenishment request is processed. A request "
        "of 5 is processed for B101, and its stock becomes 15. Option 6 is then selected, "
        "and option 2 confirms that the stock returns to 10, so the test is passed."
    ),
    "T16": (
        "For T16, Undo is tested after the Book is deleted. B101 is updated and deleted "
        "before option 6 is selected. The program shows “Book no longer exists”, so the "
        "deleted Book is not restored and the test is passed."
    ),
    "T17": (
        "For T17, two replenishment requests are processed to check the FIFO order. "
        "Requests for B201 with quantity 10 and B202 with quantity 15 are added, and "
        "option 8 is used twice. Zeta Systems is processed first and its stock becomes "
        "19, then Alpha Algorithms is processed and its stock becomes 23, so the test "
        "is passed."
    ),
    "T18": (
        "For T18, a replenishment request for an unknown Book is tested. Option 7 is "
        "selected and B999 with quantity 1000 is entered. The program shows “Invalid "
        "request”, so the request is not added and the test is passed."
    ),
    "T19": (
        "For T19, processing is tested when the Queue is empty. Option 8 is selected "
        "when no request is waiting, and the program shows “No replenishment requests”, "
        "so the test is passed."
    ),
    "T20": (
        "For T20, the Queue capacity of ten is tested. Eleven replenishment requests "
        "are entered for B101. The tenth request is added, but the eleventh request "
        "shows “Replenishment queue is full”, so the Queue does not exceed its capacity "
        "and the test is passed."
    ),
    "T21": (
        "For T21, Merge Sort is tested with the title key. Three Books are added, "
        "option 2 displays them, and option 5 sorts them by title. The output shows "
        "Alpha Algorithms, middle Data and Zeta Systems in ascending title order while "
        "ignoring case, so the test is passed."
    ),
    "T22": (
        "For T22, Merge Sort is tested with the price key. Three Books are added, "
        "option 2 displays them, and option 5 sorts them by price. The output shows "
        "20000.00, 25000.00 and 30000.00 MMK in ascending order, so the test is passed."
    ),
    "T23": (
        "For T23, an invalid sort key is tested. Option 5 is selected and author is "
        "entered as the sort key. The program shows “Invalid sort key”, so sorting is "
        "cancelled and the test is passed."
    ),
    "T24": (
        "For T24, the shortest route from Golden Pages Warehouse (Hlaing) to Botataung "
        "Pagoda is tested. Option 9 is selected and both locations are entered. The "
        "program returns the route through Hledan, Sanchaung, Myaynigone, Downtown and "
        "Sule Pagoda with a total distance of 12 km, so the test is passed."
    ),
    "T25": (
        "For T25, an unknown graph location is tested. Option 9 is selected with Hledan "
        "Branch as the start and Time City as the destination. The program shows "
        "“Location not found or no route available”, so the invalid location is handled "
        "and the test is passed."
    ),
    "T26": (
        "For T26, the Exit option is tested. Option 0 is selected, the program shows "
        "“Program ended.” and the shell prints exit code 0. This confirms that the "
        "program closes successfully, so the test is passed."
    ),
}


def replace_paragraph_text(paragraph, text: str) -> None:
    """Replace paragraph runs while preserving paragraph-level formatting."""
    for run in list(paragraph.runs):
        paragraph._element.remove(run._element)
    paragraph.add_run(text)


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: rewrite_manual_test_paragraphs.py <document.docx>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1]).resolve()
    doc = Document(path)
    found: dict[str, int] = {}

    for index, paragraph in enumerate(doc.paragraphs):
        match = re.match(r"^(T(?:1[0-9]|2[0-6]))\s+Test:", paragraph.text.strip())
        if not match:
            continue
        test_id = match.group(1)
        if test_id in found:
            raise RuntimeError(f"Duplicate structured paragraph for {test_id}")
        replace_paragraph_text(paragraph, REWRITES[test_id])
        found[test_id] = index

    expected = set(REWRITES)
    if set(found) != expected:
        missing = sorted(expected - set(found))
        unexpected = sorted(set(found) - expected)
        raise RuntimeError(f"Test paragraph mismatch: missing={missing}, unexpected={unexpected}")

    temporary = path.with_name(f".{path.name}.rewrite.tmp")
    doc.save(temporary)
    os.replace(temporary, path)

    print(f"Updated {len(found)} test paragraphs in {path}")
    for test_id in sorted(found, key=lambda value: int(value[1:])):
        print(f"{test_id}: paragraph {found[test_id]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
