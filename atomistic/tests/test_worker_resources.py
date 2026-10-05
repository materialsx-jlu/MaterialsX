"""The monitor must tolerate atomic checkpoint renames without hiding actual errors."""
from types import SimpleNamespace
import stat
import psutil
import pytest
from worker import resource_usage

class File:
    def __init__(self, failure=None): self.failure = failure
    def stat(self):
        if self.failure: raise self.failure
        return SimpleNamespace(st_mode=stat.S_IFREG, st_size=7)

class Directory:
    def __init__(self, *paths): self.paths = paths
    def iterdir(self): return iter(self.paths)

class Child:
    def memory_info(self): raise psutil.NoSuchProcess(123)

class Process:
    def memory_info(self): return SimpleNamespace(rss=100)
    def children(self, recursive): return [Child()]

def test_monitor_tolerates_atomic_rename_and_finished_child():
    assert resource_usage(Process(), Directory(File(FileNotFoundError()), File())) == (100, 7)

def test_monitor_does_not_ignore_permission_failure():
    with pytest.raises(PermissionError):
        resource_usage(Process(), Directory(File(PermissionError())))
