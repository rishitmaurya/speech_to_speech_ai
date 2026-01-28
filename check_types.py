from google.genai.types import LiveConnectConfig
import pprint

print("Fields in LiveConnectConfig:")
# Check if it uses __annotations__ (dataclass) or model_fields (pydantic) or just slots
if hasattr(LiveConnectConfig, '__annotations__'):
    pprint.pprint(list(LiveConnectConfig.__annotations__.keys()))
elif hasattr(LiveConnectConfig, 'model_fields'):
    pprint.pprint(list(LiveConnectConfig.model_fields.keys()))
else:
    pprint.pprint(dir(LiveConnectConfig))
