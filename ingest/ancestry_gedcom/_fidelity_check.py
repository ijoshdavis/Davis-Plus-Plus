"""One-off script: verify gedcom-lite preserves _APID and record counts on round trip.

Not part of the ingest pipeline - run manually before trusting the library. See
docs/build-plan.md #3 (Dependencies) and #7 (a lossy parser is the top risk).
"""

import sys
import gedcom_lite as g


def apid_count(doc: g.GedcomDocument) -> int:
    n = 0
    for s in doc.all_structures():
        if s.tag == "_APID":
            n += 1
    return n


def check(path: str) -> None:
    print(f"=== {path} ===")
    doc = g.parse(path)
    counts = doc.record_counts()
    print("record_counts:", counts)
    print("_APID (initial parse):", apid_count(doc))
    print("parse_warnings:", len(doc.parse_warnings), doc.parse_warnings[:5])

    roundtrip_bytes = doc.write()
    doc2 = g.GedcomDocument.parse(roundtrip_bytes)
    counts2 = doc2.record_counts()
    print("record_counts (after round trip):", counts2)
    print("_APID (after round trip):", apid_count(doc2))

    assert counts == counts2, f"record counts changed on round trip: {counts} != {counts2}"
    assert apid_count(doc) == apid_count(doc2), "APID count changed on round trip"
    print("OK: round trip preserved record counts and _APID count\n")


if __name__ == "__main__":
    for path in sys.argv[1:]:
        check(path)
