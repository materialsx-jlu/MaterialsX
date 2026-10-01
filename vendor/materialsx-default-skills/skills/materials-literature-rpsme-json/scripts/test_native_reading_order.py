import unittest
import pymupdf
from prepare_pdf import native_page_text


class NativeReadingOrderTests(unittest.TestCase):
    def test_two_column_paragraphs_remain_contiguous(self):
        document = pymupdf.open()
        page = document.new_page(width=600, height=800)
        page.insert_textbox(pymupdf.Rect(40, 60, 270, 300),
                            "LEFT paragraph first line\nLEFT paragraph second line", fontsize=12)
        page.insert_textbox(pymupdf.Rect(320, 60, 560, 300),
                            "RIGHT paragraph first line\nRIGHT paragraph second line", fontsize=12)
        text = native_page_text(page)
        self.assertIn("LEFT paragraph first line\nLEFT paragraph second line", text)
        self.assertIn("RIGHT paragraph first line\nRIGHT paragraph second line", text)
        self.assertLess(text.index("LEFT paragraph second"), text.index("RIGHT paragraph first"))
        document.close()


if __name__ == "__main__":
    unittest.main()
