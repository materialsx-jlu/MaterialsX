"""Network/disk fault controls, not independent scientific accuracy evidence."""
import errno
import json
import socket
from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from worker import atomic_json

def test_worker_denies_outbound_python_network():
    with pytest.raises(RuntimeError,match='ATOMISTIC_NETWORK_DISABLED'):
        socket.create_connection(('example.invalid',443),timeout=.01)
    with socket.socket() as s:
        with pytest.raises(RuntimeError,match='ATOMISTIC_NETWORK_DISABLED'):
            s.connect(('127.0.0.1',9))

def test_disk_full_does_not_replace_last_committed_json(tmp_path,monkeypatch):
    path=tmp_path/'result.json'
    atomic_json(path,{'status':'previous-real-file'})
    def fail(*args,**kwargs): raise OSError(errno.ENOSPC,'Injected disk full')
    monkeypatch.setattr(Path,'write_text',fail)
    with pytest.raises(OSError) as e: atomic_json(path,{'status':'new-uncommitted-file'})
    assert e.value.errno==errno.ENOSPC
    assert json.loads(path.read_text())=={'status':'previous-real-file'}
