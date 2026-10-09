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

if __name__ == '__main__':
    unittest.main()
