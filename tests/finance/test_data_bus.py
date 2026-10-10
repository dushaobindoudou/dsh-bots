import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'skills/finance-skill/scripts/data_bus.py'
spec = importlib.util.spec_from_file_location('data_bus', SCRIPT)
bus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bus)

class DataBusTest(unittest.TestCase):
    def test_exchange_and_share_class(self):
        self.assertEqual(bus.normalize('920002.BJ')['tx'], 'bj920002')
        self.assertEqual(bus.normalize('920002')['exchange'], 'bj')
        self.assertEqual(bus.normalize('600519.SH')['exchange'], 'sh')
        self.assertEqual(bus.normalize('00700.HK')['code'], '00700')
        self.assertEqual(bus.normalize('BRK.B')['code'], 'BRK.B')
        self.assertEqual(bus.normalize('AAPL.US')['code'], 'AAPL')

    def test_hk_does_not_use_a_share_units_or_limit_prices(self):
        fields = [''] * 65
        for i, value in {1: '腾讯控股', 2: '00700', 3: '423.4', 6: '10501259', 30: '2026/10/09 13:34:58',
                         37: '4401987315.25', 39: '15.47', 46: 'TENCENT', 47: '1.26', 48: '663.7'}.items():
            fields[i] = value
        quote, _ = bus._tx_quote_from_fields(fields, 'hk00700')
        self.assertNotIn('limit_up', quote)
        self.assertNotIn('amount_wan', quote)
        self.assertEqual(quote['amount'], 4401987315.25)
        self.assertEqual(quote['currency'], 'HKD')
        self.assertEqual(quote['volume_unit'], 'shares')
        self.assertEqual(quote['timestamp'], '2026/10/09 13:34:58')

    def test_timestamps_keep_string_precision_and_missing_numbers_are_null(self):
        fields = [''] * 65
        fields[1:4] = ['茅台', '600519', '1271.95']
        fields[30] = '20261009135832'
        fields[39] = 'NaN'
        quote, _ = bus._tx_quote_from_fields(fields, 'sh600519')
        self.assertEqual(quote['timestamp'], '20261009135832')
        self.assertIsNone(quote['pe_ttm'])

    def test_empty_source_result_is_not_success(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit) as error:
                bus._emit(True, {'rows': []}, source='provider')
        self.assertEqual(error.exception.code, 1)
        self.assertFalse(json.loads(out.getvalue())['ok'])

    def test_kline_never_falls_back_to_a_different_period_or_adjustment(self):
        raw = json.dumps({'code': 0, 'data': {'sh600519': {'day': [['2026-10-09', '1', '2', '3', '1', '4']]}}})
        with patch.object(bus, '_http', return_value=raw):
            with self.assertRaisesRegex(RuntimeError, 'K线'):
                bus._tx_kline('600519', period='week', adjust='qfq', count=2)

    def test_runbook_period_alias_and_error_exit_status(self):
        with patch.object(sys, 'argv', ['data_bus.py', 'kline', '--code', '600519', '--period', 'daily']), \
                patch.object(bus, '_tx_kline', return_value={'symbol': 'sh600519', 'rows': [['2026-10-09', '1', '2', '3', '1', '4']]}), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            bus.main()
            self.assertTrue(json.loads(out.getvalue())['ok'])
        result = subprocess.run([sys.executable, str(SCRIPT), 'financial', '--code', '00700'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(json.loads(result.stdout)['ok'])

    # 2026-10-10: a room of bots never found MiniMax's code (no name lookup,
    # they scanned 02300-02699), declared it "not listed", and quoted 智谱's
    # turnover as its market cap. The data layer now resolves names from the
    # source and reports only cross-checked market caps.
    SMARTBOX = ('hk~00100~minimaxw~minimaxw~GP^hk~02513~\\u667a\\u8c31~zp~GP^'
                'hk~13093~\\u667a\\u8c31\\u6c47\\u4e30\\u516d\\u4e59\\u8d2dA~zphflyga~QZ^'
                'sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A^us~tme.n~\\u817e\\u8baf\\u97f3\\u4e50~txyl~GP')

    def test_smartbox_entries_decode_into_quotable_codes(self):
        rows = bus._parse_smartbox(self.SMARTBOX)
        self.assertEqual([r['quote_code'] for r in rows], ['00100.HK', '02513.HK', '13093.HK', '600519.SH', 'TME'])
        self.assertEqual(rows[1]['name'], '智谱')
        self.assertEqual(rows[2]['type_label'], '权证/牛熊证')

    def _search(self, raw, *args):
        with patch.object(bus, '_http', return_value=f'v_hint="{raw}"'), contextlib.redirect_stdout(io.StringIO()) as out:
            try:
                bus.cmd_search(*args)
            except SystemExit:
                pass
        return json.loads(out.getvalue())

    def test_search_hides_warrants_and_filters_market(self):
        result = self._search(self.SMARTBOX, '智谱', 'hk')
        self.assertTrue(result['ok'])
        self.assertEqual([m['code'] for m in result['data']['matches']], ['00100', '02513'])
        self.assertEqual(result['data']['derivatives_hidden'], 1)
        self.assertEqual(result['meta']['source'], 'tencent:smartbox')

    def test_search_miss_is_not_found_never_not_listed(self):
        result = self._search('N', '不存在的公司')
        self.assertFalse(result['ok'])
        self.assertIn('未找到', result['error'])
        self.assertIn('查不到≠不存在/未上市', result['hint'])
        self.assertIn('不要扫号段猜代码', result['hint'])

    def _hk_fields(self, cap_yi):
        fields = [''] * 78
        for i, value in {1: '智谱', 2: '02513', 3: '641.5', 6: '5023731', 30: '2026/10/09 16:08:12',
                         37: '3144565559.0', 44: '1687.5274', 45: cap_yi, 69: '487588090', 70: '263059605'}.items():
            fields[i] = value
        return fields

    def test_hk_market_cap_is_cross_checked_and_never_the_turnover(self):
        quote, _ = bus._tx_quote_from_fields(self._hk_fields('3127.8776'), 'hk02513')
        self.assertAlmostEqual(quote['market_cap'], 641.5 * 487588090, places=0)
        self.assertAlmostEqual(quote['h_share_market_cap'], 641.5 * 263059605, places=0)
        self.assertNotEqual(quote['market_cap'], quote['amount'])
        self.assertIn('amount 是当日成交额（turnover），不是市值', quote['notes'])

    def test_market_cap_that_disagrees_with_shares_is_withheld(self):
        quote, _ = bus._tx_quote_from_fields(self._hk_fields('31.4'), 'hk02513')
        self.assertIsNone(quote['market_cap'])
        self.assertTrue(any('不予报告' in note for note in quote['notes']))

    def test_quote_without_data_points_to_search(self):
        with patch.object(bus, '_http', return_value='v_hk09999="";'), contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit):
                bus.cmd_quote('09999')
        result = json.loads(out.getvalue())
        self.assertFalse(result['ok'])
        self.assertIn('search --name', result['hint'])

if __name__ == '__main__':
    unittest.main()
