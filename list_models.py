import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})

try:
    print("Listing Flash models with v1alpha:")
    for m in client.models.list():
        if "flash" in m.name:
            print(f" - {m.name}")
except Exception as e:
    print(f"Error v1alpha: {e}")

client_beta = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
try:
    print("\nListing Flash models with v1beta:")
    for m in client_beta.models.list():
        if "flash" in m.name:
            print(f" - {m.name}")
except Exception as e:
    print(f"Error v1beta: {e}")
