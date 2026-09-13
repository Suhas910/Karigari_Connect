"""
Where uploaded artisan media lives.

Two backends behind one interface, chosen by `CRAFTLINK_MEDIA_STORAGE` and read at call
time (the same pattern as `app/ai/config.py`, so tests can change it):

    local     (default) files under CRAFTLINK_MEDIA_DIR, default backend/media_store/
    supabase  a PRIVATE Supabase Storage bucket named by CRAFTLINK_MEDIA_BUCKET
              (default "media")

Both are private. Nothing here produces a public URL: media is read back through
`GET /api/v1/media/{id}/content`, which checks who is asking. Voice notes and workshop
photos are personal data, and a public URL cannot be revoked once it has been shared.

The Supabase backend refuses a public bucket instead of using it. Checked 2026-09-13:
the project's only bucket, `product_images`, is public, so it is not usable for this.

There is deliberately no fallback between backends. `supabase_client.DummySupabase`
accepts an upload and stores nothing; a store that silently loses an artisan's
recording is worse than one that fails loudly.
"""

from __future__ import annotations

import functools
import os
import tempfile
from pathlib import Path
from typing import Protocol

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


class StorageUnavailable(Exception):
    """The configured store cannot be used right now."""


class MediaNotFound(Exception):
    """The store has no object under this key."""


class MediaStore(Protocol):
    name: str

    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def get(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...


def _check_key(key: str) -> None:
    parts = key.split("/")
    if not key or key.startswith("/") or "\\" in key or any(p in ("", ".", "..") for p in parts):
        raise ValueError(f"Unsafe storage key: {key!r}")


class LocalMediaStore:
    name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        _check_key(key)
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError(f"Storage key escapes the media root: {key!r}")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Write-then-rename, so a crash mid-write never leaves a truncated file under
            # a key the database already points at.
            fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
            try:
                with os.fdopen(fd, "wb") as fh:
                    fh.write(data)
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(tmp, path)
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
        except OSError as exc:
            raise StorageUnavailable(f"Local media store could not write {key!r}: {exc}") from exc

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError as exc:
            raise MediaNotFound(key) from exc
        except OSError as exc:
            raise StorageUnavailable(f"Local media store could not read {key!r}: {exc}") from exc

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class SupabaseMediaStore:
    name = "supabase"

    def __init__(self, client, bucket: str) -> None:
        try:
            info = client.storage.get_bucket(bucket)
        except Exception as exc:  # the SDK raises its own types; any of them means "cannot use"
            raise StorageUnavailable(f"Supabase bucket {bucket!r} is not reachable: {exc}") from exc
        if getattr(info, "public", True):
            raise StorageUnavailable(
                f"Supabase bucket {bucket!r} is public. Artisan media must go to a private "
                "bucket; create one and set CRAFTLINK_MEDIA_BUCKET."
            )
        self._bucket = client.storage.from_(bucket)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        _check_key(key)
        try:
            self._bucket.upload(key, data, {"content-type": content_type, "upsert": "false"})
        except Exception as exc:
            raise StorageUnavailable(f"Supabase upload failed for {key!r}: {exc}") from exc

    def get(self, key: str) -> bytes:
        _check_key(key)
        try:
            return self._bucket.download(key)
        except Exception as exc:
            raise StorageUnavailable(f"Supabase download failed for {key!r}: {exc}") from exc

    def delete(self, key: str) -> None:
        _check_key(key)
        try:
            self._bucket.remove([key])
        except Exception as exc:
            raise StorageUnavailable(f"Supabase delete failed for {key!r}: {exc}") from exc


def storage_mode() -> str:
    return (os.getenv("CRAFTLINK_MEDIA_STORAGE") or "local").strip().lower()


def media_dir() -> Path:
    raw = os.getenv("CRAFTLINK_MEDIA_DIR", "").strip()
    return Path(raw) if raw else _BACKEND_ROOT / "media_store"


def bucket_name() -> str:
    return (os.getenv("CRAFTLINK_MEDIA_BUCKET") or "media").strip()


@functools.lru_cache(maxsize=4)
def _supabase_store(bucket: str) -> SupabaseMediaStore:
    # Cached so the bucket check is one network call per process, not one per request.
    # A failed check raises, and lru_cache does not cache exceptions, so it is retried.
    from .supabase_client import DummySupabase, supabase

    if isinstance(supabase, DummySupabase):
        raise StorageUnavailable(
            "CRAFTLINK_MEDIA_STORAGE=supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY "
            "are not configured."
        )
    return SupabaseMediaStore(supabase, bucket)


def get_media_store(mode: str | None = None) -> MediaStore:
    """The store for `mode`, or for the configured mode when omitted.

    Reading passes the backend recorded on the media row, so switching the setting later
    does not orphan files written under the previous one.
    """
    mode = (mode or storage_mode()).strip().lower()
    if mode == "local":
        return LocalMediaStore(media_dir())
    if mode == "supabase":
        return _supabase_store(bucket_name())
    raise StorageUnavailable(
        f"Unknown CRAFTLINK_MEDIA_STORAGE={mode!r}; expected 'local' or 'supabase'."
    )
