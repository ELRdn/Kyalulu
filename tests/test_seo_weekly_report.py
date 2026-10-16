import contextlib
from datetime import date
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts.seo_weekly_report import main, summarize


class WeeklyReportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "gsc.zip"
        self.start, self.end = date(2026, 10, 5), date(2026, 10, 11)

    def export(self, content, extra=None):
        with zipfile.ZipFile(self.path, "w") as archive:
            archive.writestr("Dates.csv", content)
            for name, value in (extra or {}).items():
                archive.writestr(name, value)

    def report(self):
        return summarize(self.path, self.start, self.end)

    def test_date_totals_only_and_inclusive_period(self):
        self.export("Date,Clicks,Impressions\n2026-10-04,9,90\n2026-10-05,1,10\n2026-10-11,2,20\n2026-10-12,8,80\n",
                    {"Queries.csv": "Top queries,Clicks,Impressions\ncharacter ai,99,999\n"})
        report = self.report()
        self.assertEqual((report["clicks"], report["impressions"], report["ctr_percent"]), (3, 30, "10"))
        self.assertEqual(report["missing_dates"], 5)

    def test_japanese_bom_and_grouped_integer(self):
        self.export('\ufeff日付,クリック数,表示回数\n2026-10-05,10,"1,000"\n')
        self.assertEqual(self.report()["impressions"], 1000)

    def test_empty_period_is_unknown_not_zero(self):
        self.export("Date,Clicks,Impressions\n2026-10-04,0,0\n")
        report = self.report()
        self.assertIsNone(report["clicks"])
        self.assertEqual(report["coverage"], "no_data")

    def test_zero_is_measured_only_with_a_date_row(self):
        self.export("Date,Clicks,Impressions\n2026-10-05,0,0\n")
        self.assertEqual(self.report()["clicks"], 0)
        self.assertIsNone(self.report()["ctr_percent"])

    def test_invalid_or_ambiguous_exports_fail(self):
        for content, extra in [
            ("Date,Clicks,Impressions\n2026-10-05,1,10\n2026-10-05,1,10\n", None),
            ("Date,Clicks,Impressions\n2026-10-05,-1,10\n", None),
            ("Date,Clicks,Impressions\n2026-10-05,11,10\n", None),
            ("Date,Clicks\n2026-10-05,1\n", None),
            ("Date,Clicks,Impressions\n20261005,1,10\n", None),
            ("Query,Clicks,Impressions\ncharacter ai,1,10\n", None),
            ("Date,Clicks,Impressions\n", {"other.csv": "Date,Clicks,Impressions\n"}),
        ]:
            with self.subTest(content=content, extra=extra):
                self.export(content, extra)
                with self.assertRaises(ValueError):
                    self.report()

    def test_zip_is_not_extracted_and_is_size_limited(self):
        self.export("Date,Clicks,Impressions\n", {"../../outside.txt": "ignored"})
        self.assertEqual(self.report()["coverage"], "no_data")
        with patch("scripts.seo_weekly_report.MAX_BYTES", 1):
            with self.assertRaises(ValueError):
                self.report()

    def test_reversed_range_fails(self):
        with self.assertRaises(ValueError):
            summarize(self.path, self.end, self.start)

    def test_cli_does_not_combine_overlapping_exports_or_infer_ai(self):
        self.export("Date,Clicks,Impressions\n2026-10-05,1,10\n")
        output = io.StringIO()
        with patch("sys.argv", ["report", str(self.path), str(self.path), "--start", "2026-10-05", "--end", "2026-10-11"]):
            with contextlib.redirect_stdout(output):
                main()
        result = json.loads(output.getvalue())
        self.assertEqual(len(result["gsc_exports"]), 2)
        self.assertFalse(result["exports_combined"])
        self.assertEqual(result["ai_attribution"], "not_inferred")


if __name__ == "__main__":
    unittest.main()
