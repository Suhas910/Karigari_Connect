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
    def upload(self, filename, contents):
        pass
    def get_public_url(self, filename):
        return f"https://karigari-storage.local/{filename}"

class DummyStorage:
    def from_(self, bucket_name):
        return DummyStorageBucket()

class DummySupabase:
    storage = DummyStorage()

if supabase is None:
    supabase = DummySupabase()
