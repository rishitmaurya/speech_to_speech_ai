import os
import asyncio
import json
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from google import genai
from google.genai.types import (
    LiveConnectConfig,
    VoiceConfig,
    PrebuiltVoiceConfig,
    SpeechConfig,
    Modality,
)

load_dotenv()

app = FastAPI()

# Mount static files
# Use absolute path to avoid deployment issues
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
else:
    print(f"WARNING: Static directory not found at {static_dir}")

@app.get("/")
async def get():
    return FileResponse(os.path.join(static_dir, "index.html"))

MODEL = "gemini-2.5-flash-native-audio-latest"

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Get API key
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        await websocket.close(code=1008, reason="API Key not found on server")
        return

    client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})

    # Wait for initial config from client (voice selection)
    try:
        init_data = await websocket.receive_text()
        init_config = json.loads(init_data)
        voice_name = init_config.get("voice", "Zephyr")
    except Exception:
        voice_name = "Zephyr"

    # Configuration for Gemini Live
    # Reverted to AUDIO only because TEXT modality causes immediate connection closure with this model.
    # Configuration for Gemini Live
    config = LiveConnectConfig(
        response_modalities=[Modality.AUDIO],
        speech_config=SpeechConfig(
            voice_config=VoiceConfig(
                prebuilt_voice_config=PrebuiltVoiceConfig(
                    voice_name=voice_name
                )
            )
        ),
        system_instruction='You are Vidya. Listen effectively. When the user speaks, they may interrupt you. If you hear them speak, stop immediately and address them. Make sure to speak in a tone in which the user is speaking with you. Your output must be concise. IMPORTANT: Detect the language the user is speaking and respond in that EXACT SAME language. If the user speaks Hindi, speak Hindi. If the user speaks Spanish, speak Spanish. Do not default to English.',
        input_audio_transcription={},  # Enable input transcription
        output_audio_transcription={}, # Enable output transcription
    )


    try:
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            
            # Send initial greeting prompt to the model
            await session.send(input="Hello! Greet the user enthusiastically to start the conversation.", end_of_turn=True)

            async def send_to_gemini():
                try:
                    while True:
                        # Receive audio data from client (base64 encoded PCM)
                        data = await websocket.receive_text()
                        message = json.loads(data)
                        
                        if "realtime_input" in message:
                            # Frontend sends base64 PCM
                            b64_data = message["realtime_input"]["media"]["data"]
                            await session.send(input={"data": b64_data, "mime_type": "audio/pcm;rate=16000"}, end_of_turn=False)
                        
                except WebSocketDisconnect:
                    print("Client disconnected")
                except Exception as e:
                    print(f"Error sending to Gemini: {e}")

            async def receive_from_gemini():
                try:
                    while True:
                        async for response in session.receive():
                            server_content = response.server_content

                            
                            if server_content is None:
                                continue

                            model_turn = server_content.model_turn
                            if model_turn:
                                for part in model_turn.parts:
                                    if part.inline_data:
                                        # Send audio back to client
                                        b64_audio = base64.b64encode(part.inline_data.data).decode("utf-8")
                                        await websocket.send_json({
                                            "audio": b64_audio
                                        })
            
                            # Handle Output Transcription (Model Speech)
                            if hasattr(server_content, "output_transcription") and server_content.output_transcription:
                                if server_content.output_transcription.text:
                                    await websocket.send_json({"text": server_content.output_transcription.text, "role": "model", "type": "transcription"})
                                    
                            # Handle Input Transcription (User Speech)
                            if hasattr(server_content, "input_transcription") and server_content.input_transcription:
                                if server_content.input_transcription.text:
                                    await websocket.send_json({"text": server_content.input_transcription.text, "role": "user", "type": "transcription"})

                            # Handle Turn Complete
                            if hasattr(server_content, "turn_complete") and server_content.turn_complete:

                                 await websocket.send_json({"turnComplete": True})

                            if hasattr(server_content, "interrupted") and server_content.interrupted:
                                await websocket.send_json({"interrupted": True})
                                
                except Exception as e:
                    print(f"Error receiving from Gemini: {e}")

            # Run both tasks concurrently
            # We need a way to stop if one fails, straightforward way is gather
            # But send_to_gemini is driven by websocket.receive, so it blocks
            
            send_task = asyncio.create_task(send_to_gemini())
            receive_task = asyncio.create_task(receive_from_gemini())

            done, pending = await asyncio.wait(
                [send_task, receive_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()
    except Exception as e:
        import traceback
        with open("error_log.txt", "a") as f:
            f.write(f"Connection Error: {str(e)}\n")
            f.write(traceback.format_exc() + "\n")
        print(f"Gemini Connection Failed: {e}")
        await websocket.close(code=1011, reason=str(e))
