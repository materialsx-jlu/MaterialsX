#!/usr/bin/env python3
"""Behavioral checks for ontology semantics and training leakage safeguards."""
import copy
import unittest
from pathlib import Path
from xyz_v2 import read, validate, migrate_v1, subset, training_rows, standard_root


class XYZV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base=migrate_v1(read(Path(__file__).resolve().parents[1]/'examples/polymers-16-00897-v1.xyz.json'))

    def setUp(self): self.d=copy.deepcopy(self.base)
    def obs(self,stage,category,index=0): return self.d['records'][0][stage][category]['observations'][index]
    def rejects(self,fragment):
        report=validate(self.d)
        self.assertFalse(report['valid'])
        self.assertTrue(any(fragment in x for x in report['errors']),report['errors'])

    def test_real_paper_conversion_preserves_all_Z_and_missing_Y(self):
        result=validate(self.d)
        self.assertTrue(result['valid'],result['errors'])
        self.assertEqual(result['counts']['records'],17)
        self.assertEqual(result['counts']['numeric_Z_cells'],85)
        self.assertEqual(sum(len(r[s][c]['observations']) for r in self.d['records'] for s in ['X','Y','Z'] for c in r[s]),308)
        pre0=next(r for r in self.d['records'] if r['record_id']=='PRE0')
        self.assertEqual(pre0['Z']['stiffness']['observations'][0]['value']['data'],53600)

    def test_single_record_example(self):
        data=subset(self.d,'T370'); result=validate(data)
        self.assertTrue(result['valid'],result['errors'])
        self.assertEqual(result['counts']['numeric_Z_cells'],5)

    def test_template_not_training_data(self):
        template=read(standard_root()/'template.json')
        self.assertTrue(validate(template,allow_incomplete=True)['valid'])
        self.assertFalse(validate(template)['valid'])

    def test_required_category_cannot_disappear(self):
        del self.d['records'][0]['Y']['crystallinity']
        self.rejects('crystallinity')

    def test_zero_and_missing_are_distinct(self):
        field=self.d['records'][0]['Y']['crystallinity']
        field['status']='quantitative'
        self.rejects('coverage claim without observations')

    def test_bad_units(self):
        self.obs('Z','stiffness')['value']['data']=64.6
        self.rejects('wrong unit conversion')

    def test_ilss_not_toughness(self):
        r=self.d['records'][0]
        o=r['Z']['strength']['observations'].pop(0)
        r['Z']['interlaminar_toughness'].update(status='quantitative',observations=[o],missing_fields=[])
        self.rejects('wrong ontology category for ilss')

    def test_unknown_reference(self):
        self.obs('Z','stiffness')['evidence_ids']=['made-up']
        self.rejects('unknown reference')

    def test_source_page_bounds(self):
        self.d['evidence'][0]['page']=21
        self.rejects('page outside source')

    def test_same_specimen_not_assumed(self):
        self.d['records'][0]['lineage']['same_specimen_xyz']='confirmed'
        self.rejects('same-specimen claim requires')

    def test_post_failure_mediator_rejected(self):
        r=next(r for r in self.d['relations'] if r['id']=='R4_interface_to_strength')
        r['kind']='association'
        self.rejects('post-failure Y cannot')

    def test_cross_group_binding_rejected(self):
        self.d['relations'][0]['linkage_level']='within_group'
        self.rejects('within_group crosses records')

    def test_unsupported_causality_label(self):
        self.d['relations'][0]['kind']='identified_causal'
        self.rejects('identified_causal')

    def test_custom_metric_requires_definition(self):
        self.obs('Y','porosity')['metric']='my_porosity'
        self.rejects('custom metric requires')

    def test_non_finite_values_rejected(self):
        self.obs('Z','stiffness')['value']['data']=float('nan')
        self.rejects('Non-finite')

    def test_quantitative_proxy_overclaim_rejected(self):
        self.obs('Y','porosity')['measurement']='quantitative'
        self.rejects('nonnumeric quantitative observation')

    def test_training_keeps_paper_together_and_excludes_uncertain_fields(self):
        rows=training_rows(self.d)
        self.assertEqual(len(rows),17)
        self.assertEqual(len({r['split_group'] for r in rows}),1)
        self.assertTrue(all(r['candidate_task_fields']['X_to_Z'] for r in rows))
        self.assertFalse(any(r['candidate_task_fields']['quantitative_XYZ_chain'] for r in rows))
        pre0=next(r for r in rows if r['record_id']=='PRE0')
        self.assertNotIn('PRE0.flexural_modulus',pre0['features_and_targets']['Z'])
        self.assertTrue(any(o['reason']=='unresolved_source_conflict' for o in pre0['excluded_from_numeric_view']))
        self.assertEqual(rows[0]['missingness']['Y']['crystallinity']['status'],'not_reported')


if __name__=='__main__': unittest.main(verbosity=2)
