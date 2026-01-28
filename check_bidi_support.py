import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

# Check v1alpha
print("Checking v1alpha for bidiGenerateContent support:")
try:
    client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})
    for m in client.models.list():
        if "gemini-2.0" in m.name or "native" in m.name:
            print(f"Model: {m.name}")
            print(f"Annotations: {m.__annotations__}")
            # Also try to print the dict if possible
            # print(m.to_dict()) 
            break
except Exception as e:
    print(f"Error v1alpha: {e}")

# Check v1beta
print("\nChecking v1beta for bidiGenerateContent support:")
try:
    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    for m in client.models.list():
         if "generateContent" in m.supported_generation_methods or "bidiGenerateContent" in m.supported_generation_methods:
             print(f"Model: {m.name}")
             print(f"  Methods: {m.supported_generation_methods}")
except Exception as e:
    print(f"Error v1beta: {e}")
