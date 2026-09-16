# test_connection.py
from supabase_client import supabase

buckets = supabase.storage.list_buckets()
print(buckets)