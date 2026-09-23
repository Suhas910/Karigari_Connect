import json
from pathlib import Path
from jsonschema import validate, ValidationError

_SCHEMA_PATH = Path(__file__).parent / "taxonomy" / "listing.schema.json"
_SCHEMA = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_catalogue(catalogue_dict: dict) -> tuple[bool, str | None]:
    try:
        validate(instance=catalogue_dict, schema=_SCHEMA)
        return True, None
    except ValidationError as e:
        return False, e.message
