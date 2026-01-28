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
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get():
    return FileResponse("static/index.html")

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

    # STABLE FALLBACK CONFIGURATION
    # We revert to the only configuration that connected successfully:
    # Native Audio Model + Audio Modality + Custom Voice.
    # Text Modality is NOT supported by this model.
    config = LiveConnectConfig(
        response_modalities=[Modality.AUDIO],
        speech_config=SpeechConfig(
            voice_config=VoiceConfig(
                prebuilt_voice_config=PrebuiltVoiceConfig(
                    voice_name=voice_name
                )
            )
        ),
        system_instruction='You are Echo, a highly empathetic and expressive AI companion. Your voice should reflect natural human emotions—be warm, enthusiastic, curious, or gentle. Use human-like fillers (um, ah, oh) occasionally. You are engaged in a real-time voice conversation. ALWAYS speak in English. Keep responses fluid and natural.',
    )


    async with client.aio.live.connect(model=MODEL, config=config) as session:
        
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
                                    # Data is bytes, need to base64 encode for JSON
                                    b64_audio = base64.b64encode(part.inline_data.data).decode("utf-8")
                                    await websocket.send_json({
                                        "audio": b64_audio
                                    })
                        

                        
                        if server_content.model_turn and server_content.model_turn.parts:
                             for part in server_content.model_turn.parts:
                                # DEBUG: Inspect every part received
                                if part.text:
                                    print(f"DEBUG: Raw Text: {part.text[:50]}")

                                # Filter out "thought" parts if present (or heuristically if using strict text model)
                                if part.text and not getattr(part, "thought", False):
                                    # Fallback heuristic: thoughts often start with **
                                    # Temporarily relaxed filter to debug if text is being hidden?
                                    # if not part.text.strip().startswith("**"):
                                    await websocket.send_json({"text": part.text, "role": "model"})
                                    
                        # Check for missing getattr to be safe if types differ
                        if hasattr(server_content, "turn_complete") and server_content.turn_complete:
                             await websocket.send_json({"turnComplete": True})
                        
                        # Handle Input Transcription (User Speech)
                        # Explicitly check for the attribute just in case
                        if hasattr(server_content, "input_transcription") and server_content.input_transcription:
                            if server_content.input_transcription.text:
                                await websocket.send_json({"text": server_content.input_transcription.text, "role": "user"})

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
