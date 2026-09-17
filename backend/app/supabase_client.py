# backend/app/supabase_client.py
import os
import logging
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = None

if SUPABASE_URL and SUPABASE_KEY:
    try:
        from supabase import create_client
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase client initialized.")
    except Exception as e:
        logger.warning(f"Failed to initialize Supabase client: {e}")

class DummyStorageBucket:
    def upload(self, filename: str, contents: bytes, file_options: dict = None):
        return {"path": filename}
    def get_public_url(self, filename: str):
        return f"https://karigari-storage.local/{filename}"

class DummyStorage:
    def from_(self, bucket_name: str):
        return DummyStorageBucket()
    def list_buckets(self):
        return []

class DummySupabase:
    storage = DummyStorage()

if supabase is None:
    supabase = DummySupabase()

def upload_media_bytes(bucket_name: str, filename: str, contents: bytes, content_type: str = "application/octet-stream") -> str:
    """
    Uploads raw file bytes to Supabase storage bucket and returns a fetchable URL.
    """
    try:
        supabase.storage.from_(bucket_name).upload(filename, contents)
        return supabase.storage.from_(bucket_name).get_public_url(filename)
    except Exception as e:
        logger.warning(f"Supabase upload fallback: {e}")
        return f"https://karigari-storage.local/{filename}"