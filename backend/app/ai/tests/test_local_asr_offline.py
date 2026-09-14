"""The local speech adapter never downloads a model in the middle of a request."""

import pytest

from app.ai.adapters.local_asr import ALLOW_DOWNLOAD_ENV, LocalWhisperASRAdapter
from app.ai.contracts import AIError, ErrorCode

pytest.importorskip("faster_whisper")


def test_a_missing_model_is_refused_instead_of_downloaded(tmp_path, monkeypatch):
    monkeypatch.delenv(ALLOW_DOWNLOAD_ENV, raising=False)
    adapter = LocalWhisperASRAdapter("tiny", download_root=str(tmp_path))
    with pytest.raises(AIError) as raised:
        adapter._load()
    assert raised.value.code == ErrorCode.PROVIDER_UNAVAILABLE
    assert "not downloaded" in str(raised.value)
    assert not any(tmp_path.iterdir()), "nothing may be fetched while refusing"
