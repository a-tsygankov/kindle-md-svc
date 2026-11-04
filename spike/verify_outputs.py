"""Independent structural checks for the two synthetic EPUB/PDF proof outputs.

Run after npm run proof. Requires PyMuPDF for PDF inspection:
    uv run --with pymupdf python spike/verify_outputs.py
These are not a substitute for EPUBCheck or a real Kindle import.
"""
import hashlib
import json
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

import fitz


out = Path(sys.argv[1] if len(sys.argv) > 1 else "output/proof")
fixtures = Path(__file__).parent / "fixtures"
report = json.loads((out / "report.json").read_text())
expected = {"reading-sample": (3, 2), "diagram-stress": (3, 3)}
ns = {"opf": "http://www.idpf.org/2007/opf", "html": "http://www.w3.org/1999/xhtml"}

for item in report["results"]:
    stem = Path(item["source"]).stem
    image_count, diagram_count = expected[stem]
    assert item["diagrams"] == diagram_count
    assert not item["warnings"], item["warnings"]
    original = (fixtures / item["source"]).read_bytes()
    assert hashlib.sha256(original).hexdigest() == item["sourceSha256"], "source changed"
    with zipfile.ZipFile(out / f"{stem}.epub") as epub:
        assert epub.namelist()[0] == "mimetype"
        assert epub.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
        assert epub.read("mimetype") == b"application/epub+zip"
        container = ET.fromstring(epub.read("META-INF/container.xml"))
        package_path = container.find(".//{*}rootfile").attrib["full-path"]
        package = ET.fromstring(epub.read(package_path))
        folder = posixpath.dirname(package_path)
        manifest = package.findall("opf:manifest/opf:item", ns)
        by_id = {entry.attrib["id"]: entry for entry in manifest}
        embedded_images = [entry for entry in manifest if entry.attrib["media-type"].startswith("image/")]
        assert len(embedded_images) == image_count
        assert any("nav" in entry.attrib.get("properties", "").split() for entry in manifest)
        spine = package.findall("opf:spine/opf:itemref", ns)
        assert spine
        for entry in spine:
            assert entry.attrib["idref"] in by_id
        for entry in manifest:
            target = unquote(entry.attrib["href"])
            assert not urlsplit(target).scheme
            resource = posixpath.normpath(posixpath.join(folder, target))
            assert resource in epub.namelist(), resource
            if entry.attrib["media-type"] == "application/xhtml+xml":
                content = epub.read(resource)
                page = ET.fromstring(content)
                assert not page.findall(".//html:script", ns)
                for img in page.findall(".//html:img", ns):
                    src = img.attrib["src"]
                    assert not urlsplit(src).scheme
                    embedded = posixpath.normpath(posixpath.join(posixpath.dirname(resource), unquote(src)))
                    assert embedded in epub.namelist(), embedded
        combined = b" ".join(epub.read(name) for name in epub.namelist() if name.endswith(".xhtml"))
        if stem == "diagram-stress":
            assert b"Example --&gt; Documentation" in combined
        else:
            assert b"flowchart TB" not in combined
    doc = fitz.open(out / f"{stem}.pdf")
    text = "\n".join(page.get_text() for page in doc)
    assert len(doc) > 0
    assert "mermaid" in text.lower()  # Explanatory text remains selectable.
    assert sum(len(page.get_images()) for page in doc) == image_count
    if stem == "reading-sample":
        for word in ("café", "naïve", "résumé"):
            assert word in text, word
        assert any(page.get_links() for page in doc), "missing PDF link"
    for page in doc:
        assert not page.get_text().strip().isdigit(), "empty page"
        for block in page.get_text("dict")["blocks"]:
            if block["type"] == 0:
                x0, y0, x1, y1 = block["bbox"]
                assert x0 >= 0 and y0 >= 0 and x1 <= page.rect.width + 1 and y1 <= page.rect.height + 1
    print(f"PASS {stem}: valid embedded EPUB resources, {image_count} images, {len(doc)} PDF pages, selectable text, source unchanged")

print("Proof checks passed. Actual Kindle import, annotations, and EPUBCheck remain unverified.")
