from pathlib import Path

from docx import Document


SOURCE = Path("/Users/happer/CRP/Part 1 Primary Research Report by Mr Wint Khant Lin HND 66.docx")
OUTPUT = Path("/Users/happer/CRP/Part 1 Primary Research Report by Mr Wint Khant Lin HND 66 updated.docx")
ANCHOR = (
    "A quantitative-dominant mixed-method design combined technical packet observations "
    "with an online questionnaire."
)
ADDITION = (
    " The technical observations used purposive sampling because the 35 authorised networks "
    "were deliberately selected to include a range of network contexts and security protocols. "
    "This approach supported comparison across Open, mixed WPA/WPA2, WPA2 and WPA3 "
    "configurations, but it was not random sampling and does not make the dataset representative "
    "of all Wi-Fi networks."
)


document = Document(SOURCE)
matches = [paragraph for paragraph in document.paragraphs if paragraph.text.startswith(ANCHOR)]
if len(matches) != 1:
    raise RuntimeError(f"Expected one methodology paragraph, found {len(matches)}")

paragraph = matches[0]
if "technical observations used purposive sampling" not in paragraph.text:
    paragraph.add_run(ADDITION)

document.save(OUTPUT)
print(OUTPUT)
