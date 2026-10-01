#!/usr/bin/env python3
"""Adversarial regression checks for mistakes that can corrupt materials evidence chains."""
import copy
import json
from pathlib import Path
import unittest
from validate_extraction import validate
from export_report import cell

FIXTURE = Path(__file__).resolve().parents[1] / 'examples/polymers-16-00897-v1.xyz.json'


class EvidenceChainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = json.loads(FIXTURE.read_text(encoding='utf-8'))

    def setUp(self):
        self.data = copy.deepcopy(self.base)

    def fact(self, fid):
        return next(f for f in self.data['facts'] if f['id'] == fid)

    def reject(self, text):
        result = validate(self.data)
        self.assertFalse(result['valid'])
        self.assertTrue(any(text in e for e in result['errors']), result['errors'])

    def test_example_preserves_duplicates_and_missing_quantitative_y(self):
        result = validate(self.data)
        self.assertTrue(result['valid'], result['errors'])
        self.assertEqual(result['counts']['group_records'], 17)
        self.assertEqual(result['counts']['numeric_Z_cells'], 85)
        self.assertIsNone(result['counts']['independent_experimental_samples'])
        self.assertTrue(all(g['has_reported_xyz'] for g in result['groups']))
        self.assertFalse(any(g['has_quantitative_xyz'] for g in result['groups']))
        self.assertEqual(self.fact('PRE0.flexural_modulus')['raw_value'], 53.6)
        self.assertEqual(self.fact('T415.flexural_modulus')['raw_value'], 66.3)

    def test_wrong_unit_conversion_rejected(self):
        self.fact('T370.flexural_modulus')['value'] = 64.6
        self.reject('incorrect unit conversion')

    def test_ilss_cannot_be_fracture_toughness(self):
        self.fact('T370.ilss')['category'] = 'interlaminar_toughness'
        self.reject('ILSS must be Z strength')

    def test_orphan_evidence_rejected(self):
        self.fact('T370.ilss')['evidence_ids'] = ['invented_page']
        self.reject('unknown evidence_ids')

    def test_cross_group_claim_cannot_be_within_group(self):
        self.data['relations'][0]['linkage_level'] = 'within_group'
        self.reject('within_group relation crosses groups')

    def test_invented_group_link_rejected(self):
        self.fact('T370.ilss')['group_id'] = 'unreported_batch'
        self.reject('unknown group_id')

    def test_missing_audit_category_rejected(self):
        self.data['coverage'].pop()
        self.reject('missing coverage audit')

    def test_proxy_cannot_satisfy_quantitative_coverage(self):
        c = next(c for c in self.data['coverage'] if c['category'] == 'porosity')
        c['status'] = 'quantitative'
        self.reject('quantitative coverage without quantitative fact')

    def test_post_failure_y_not_forward_measurement(self):
        r = next(r for r in self.data['relations'] if r['id']=='R4_interface_to_strength')
        r['kind'] = 'association'
        self.reject('post-failure Y cannot be a pre-failure')

    def test_page_outside_pdf_rejected(self):
        self.data['evidence'][0]['page'] = 21
        self.reject('page outside PDF')

    def test_causal_overstatement_rejected(self):
        self.data['relations'][0]['kind'] = 'proven_causal'
        self.reject('invalid/overstated causal kind')

    def test_simulation_without_model_rejected(self):
        self.fact('T370.ilss')['origin'] = 'simulated'
        self.reject('simulated requires simulation')

    def test_nonfinite_numeric_rejected(self):
        self.fact('T370.ilss')['value'] = float('nan')
        self.reject('Non-finite')

    def test_csv_formula_protection_preserves_negative_numbers(self):
        self.assertEqual(cell('=HYPERLINK("https://example.org")')[0], "'")
        self.assertEqual(cell(-12.5), -12.5)


if __name__ == '__main__':
    unittest.main(verbosity=2)
